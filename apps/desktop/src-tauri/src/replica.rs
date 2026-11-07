//! The Mac's replica of the account's library: one SQLite file in the app's data dir, bundled with
//! FTS5 compiled in, which the page's replica engine (`@repo/library-replica`) reads and writes
//! through the bridge, one statement a command. The connection sits behind one mutex, and every
//! command runs on a blocking thread, never the runtime's.
//!
//! A statement the page sends alone is its own `IMMEDIATE` transaction. The engine's `exclusive`
//! holds the database for a run of statements whose results decide the next, so it cannot be one
//! command: `begin` opens a transaction on a thread of its own, which holds the connection and
//! answers each statement sent under its token until `commit`. That thread rolls back and lets go
//! when the token is dropped (a `rollback`, a page that went away, a newer `begin`) or when no
//! statement comes for a while, so a page reloaded in the middle of a transaction never wedges the
//! database. A statement outside waits out a running transaction, as the engine's port requires.
//!
//! The page sends its SQL whole, so the connection is held to the account's one file: no database
//! can be attached to it, which `ATTACH` and `VACUUM INTO` (a copy written anywhere) both need, and
//! an authorizer refuses either before it runs. Every other statement stays inside the file.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::limits::Limit;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, TransactionBehavior, params_from_iter};
use serde_json::{Map, Number};

use crate::error::{ShellError, ShellResult};

/// How long a transaction waits for its next statement before it rolls back: the engine sends
/// each as soon as the one before it answers, so a gap this long is a page that went away.
pub const TRANSACTION_IDLE_LIMIT: Duration = Duration::from_secs(10);

/// A row as the page reads it: column name to value.
pub type Row = Map<String, serde_json::Value>;

/// A statement and the values bound to its placeholders, as the page sends them.
pub struct Statement {
    pub sql: String,
    pub params: Vec<serde_json::Value>,
}

enum Step {
    All(Statement, Sender<ShellResult<Vec<Row>>>),
    Run(Statement, Sender<ShellResult<()>>),
    Commit(Sender<ShellResult<()>>),
}

struct Open {
    token: u64,
    steps: Sender<Step>,
}

pub struct Replica {
    connection: Arc<Mutex<Option<Connection>>>,
    open: Mutex<Option<Open>>,
    next_token: AtomicU64,
    idle_limit: Duration,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A value the page bound: text, a number (an integer when it is one) or null.
fn bound(value: &serde_json::Value) -> ShellResult<Value> {
    match value {
        serde_json::Value::Null => Ok(Value::Null),
        serde_json::Value::String(text) => Ok(Value::Text(text.clone())),
        serde_json::Value::Number(number) => number
            .as_i64()
            .map(Value::Integer)
            .or_else(|| number.as_f64().map(Value::Real))
            .ok_or_else(|| ShellError::Invalid(format!("{number} is no number SQLite holds"))),
        other => Err(ShellError::Invalid(format!(
            "the replica binds text, numbers and null, not {other}"
        ))),
    }
}

/// A column's value as the page reads it; the library stores no bytes, so a blob is refused.
fn read(value: ValueRef<'_>) -> ShellResult<serde_json::Value> {
    Ok(match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(integer) => serde_json::Value::Number(integer.into()),
        ValueRef::Real(real) => Number::from_f64(real)
            .map(serde_json::Value::Number)
            .ok_or_else(|| ShellError::Invalid(format!("{real} cannot cross to the page")))?,
        ValueRef::Text(text) => serde_json::Value::String(String::from_utf8_lossy(text).into()),
        ValueRef::Blob(_) => {
            return Err(ShellError::Invalid(
                "the replica holds no bytes in its rows".to_owned(),
            ));
        }
    })
}

fn query(connection: &Connection, statement: &Statement) -> ShellResult<Vec<Row>> {
    let mut prepared = connection.prepare(&statement.sql)?;
    let names: Vec<String> = prepared.column_names().map(str::to_owned).collect();
    let values = statement
        .params
        .iter()
        .map(bound)
        .collect::<ShellResult<Vec<_>>>()?;
    let mut rows = prepared.query(params_from_iter(values))?;
    let mut read_rows = Vec::new();
    while let Some(row) = rows.next()? {
        let mut columns = Row::new();
        for (index, name) in names.iter().enumerate() {
            columns.insert(name.clone(), read(row.get_ref(index)?)?);
        }
        read_rows.push(columns);
    }
    Ok(read_rows)
}

/// Whether a statement may run on the replica's connection: anything but reaching another file.
fn within_the_file(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Attach { .. } | AuthAction::Detach { .. } => Authorization::Deny,
        _ => Authorization::Allow,
    }
}

/// The account's file, held to itself: WAL, so a crash mid-write keeps the last commit, and no
/// other database reachable from it.
fn open_held(path: &Path) -> ShellResult<Connection> {
    let mut connection = Connection::open(path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)?;
    connection.authorizer(Some(within_the_file))?;
    Ok(connection)
}

/// A statement whose rows nobody reads: run to its end, so one that returns rows (an `INSERT …
/// RETURNING`) runs as one that returns none.
fn execute(connection: &Connection, statement: &Statement) -> ShellResult<()> {
    query(connection, statement).map(|_| ())
}

/// The transaction's own thread: it holds the connection from `begin` to its end, answers each
/// statement in turn, and rolls back on any way out but `commit`, since a dropped transaction
/// does.
fn hold_transaction(
    connection: &Mutex<Option<Connection>>,
    steps: &Receiver<Step>,
    began: &Sender<ShellResult<()>>,
    idle_limit: Duration,
) {
    let mut guard = lock(connection);
    let Some(connection) = guard.as_mut() else {
        let _ = began.send(Err(ShellError::SignedOut));
        return;
    };
    let transaction = match connection.transaction_with_behavior(TransactionBehavior::Immediate) {
        Ok(transaction) => transaction,
        Err(error) => {
            let _ = began.send(Err(error.into()));
            return;
        }
    };
    if began.send(Ok(())).is_err() {
        return;
    }
    loop {
        match steps.recv_timeout(idle_limit) {
            Ok(Step::All(statement, answer)) => {
                let _ = answer.send(query(&transaction, &statement));
            }
            Ok(Step::Run(statement, answer)) => {
                let _ = answer.send(execute(&transaction, &statement));
            }
            Ok(Step::Commit(answer)) => {
                let _ = answer.send(transaction.commit().map_err(ShellError::from));
                return;
            }
            Err(RecvTimeoutError::Timeout) => {
                eprintln!(
                    "[replica] a transaction waited {idle_limit:?} for its next statement: rolled back"
                );
                return;
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

impl Replica {
    pub fn new(idle_limit: Duration) -> Self {
        Self {
            connection: Arc::new(Mutex::new(None)),
            open: Mutex::new(None),
            next_token: AtomicU64::new(1),
            idle_limit,
        }
    }

    /// Opens the account's file, closing whatever was open.
    pub fn open(&self, path: &Path) -> ShellResult<()> {
        self.abandon();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let connection = open_held(path)?;
        *lock(&self.connection) = Some(connection);
        Ok(())
    }

    /// Lets the file go, as a sign-out does; what it held stays on disk until it is removed.
    pub fn close(&self) {
        self.abandon();
        lock(&self.connection).take();
    }

    /// Rolls back the open transaction, if any: its page went away.
    pub fn abandon(&self) {
        lock(&self.open).take();
    }

    fn alone<T>(
        &self,
        work: impl FnOnce(&Connection, &Statement) -> ShellResult<T>,
        statement: &Statement,
    ) -> ShellResult<T> {
        let mut guard = lock(&self.connection);
        let connection = guard.as_mut().ok_or(ShellError::SignedOut)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = work(&transaction, statement)?;
        transaction.commit()?;
        Ok(value)
    }

    /// One statement in a transaction of its own, its rows answered.
    pub fn all(&self, statement: &Statement) -> ShellResult<Vec<Row>> {
        self.alone(query, statement)
    }

    /// One statement in a transaction of its own.
    pub fn run(&self, statement: &Statement) -> ShellResult<()> {
        self.alone(execute, statement)
    }

    /// Opens a transaction once the connection is free, and answers its token. One is open at a
    /// time: a newer `begin` lets an older one go, which only a page gone mid-transaction leaves.
    pub fn begin(&self) -> ShellResult<u64> {
        let (steps, received) = mpsc::channel();
        let (began, beginning) = mpsc::channel();
        let connection = Arc::clone(&self.connection);
        let idle_limit = self.idle_limit;
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        lock(&self.open).replace(Open { token, steps });
        std::thread::spawn(move || hold_transaction(&connection, &received, &began, idle_limit));
        match beginning.recv() {
            Ok(Ok(())) => Ok(token),
            Ok(Err(error)) => {
                self.forget_token(token);
                Err(error)
            }
            Err(_) => Err(ShellError::TransactionGone),
        }
    }

    fn forget_token(&self, token: u64) -> Option<Sender<Step>> {
        let mut open = lock(&self.open);
        if open.as_ref().is_some_and(|held| held.token == token) {
            return open.take().map(|held| held.steps);
        }
        None
    }

    fn sender(&self, token: u64) -> ShellResult<Sender<Step>> {
        lock(&self.open)
            .as_ref()
            .filter(|held| held.token == token)
            .map(|held| held.steps.clone())
            .ok_or(ShellError::TransactionGone)
    }

    fn ask<T>(
        &self,
        token: u64,
        step: impl FnOnce(Sender<ShellResult<T>>) -> Step,
    ) -> ShellResult<T> {
        let (answer, answered) = mpsc::channel();
        self.sender(token)?
            .send(step(answer))
            .map_err(|_| ShellError::TransactionGone)?;
        answered.recv().map_err(|_| ShellError::TransactionGone)?
    }

    /// A statement inside the transaction `token` names, its rows answered.
    pub fn all_in(&self, token: u64, statement: Statement) -> ShellResult<Vec<Row>> {
        self.ask(token, |answer| Step::All(statement, answer))
    }

    /// A statement inside the transaction `token` names.
    pub fn run_in(&self, token: u64, statement: Statement) -> ShellResult<()> {
        self.ask(token, |answer| Step::Run(statement, answer))
    }

    pub fn commit(&self, token: u64) -> ShellResult<()> {
        let result = self.ask(token, Step::Commit);
        self.forget_token(token);
        result
    }

    /// Rolls back the transaction `token` names; one already gone has nothing left to undo.
    pub fn rollback(&self, token: u64) {
        self.forget_token(token);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn statement(sql: &str, params: Vec<serde_json::Value>) -> Statement {
        Statement {
            sql: sql.to_owned(),
            params,
        }
    }

    fn opened(idle_limit: Duration) -> ShellResult<(tempfile::TempDir, Replica)> {
        let dir = tempfile::tempdir()?;
        let replica = Replica::new(idle_limit);
        replica.open(&dir.path().join("library").join("account.sqlite"))?;
        replica.run(&statement(
            "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
            vec![],
        ))?;
        Ok((dir, replica))
    }

    fn bodies(replica: &Replica) -> ShellResult<Vec<serde_json::Value>> {
        Ok(replica
            .all(&statement("SELECT body FROM notes ORDER BY id", vec![]))?
            .into_iter()
            .filter_map(|row| row.get("body").cloned())
            .collect())
    }

    fn insert(body: &str) -> Statement {
        statement("INSERT INTO notes (body) VALUES (?)", vec![json!(body)])
    }

    #[test]
    fn no_statement_reaches_a_file_but_the_replica_s() -> ShellResult<()> {
        let (dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        let elsewhere = dir.path().join("elsewhere.sqlite");
        let target = elsewhere.to_string_lossy().replace('\'', "''");
        for sql in [
            format!("ATTACH DATABASE '{target}' AS other"),
            format!("VACUUM INTO '{target}'"),
        ] {
            assert!(
                matches!(
                    replica.run(&statement(&sql, vec![])),
                    Err(ShellError::Sql(_))
                ),
                "{sql}"
            );
        }
        assert!(!elsewhere.exists());
        // the replica's own file still takes every statement the engine sends
        replica.run(&insert("still here"))?;
        assert_eq!(bodies(&replica)?, vec![json!("still here")]);
        Ok(())
    }

    #[test]
    fn a_statement_alone_lands_on_its_own() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        replica.run(&insert("one"))?;
        assert_eq!(bodies(&replica)?, vec![json!("one")]);
        Ok(())
    }

    #[test]
    fn a_transaction_lands_whole_on_commit() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        let token = replica.begin()?;
        replica.run_in(token, insert("one"))?;
        let inside = replica.all_in(token, statement("SELECT count(*) AS n FROM notes", vec![]))?;
        assert_eq!(inside[0].get("n"), Some(&json!(1)));
        replica.run_in(token, insert("two"))?;
        replica.commit(token)?;
        assert_eq!(bodies(&replica)?, vec![json!("one"), json!("two")]);
        Ok(())
    }

    #[test]
    fn a_rollback_lands_nothing() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        let token = replica.begin()?;
        replica.run_in(token, insert("one"))?;
        replica.rollback(token);
        assert_eq!(bodies(&replica)?, Vec::<serde_json::Value>::new());
        Ok(())
    }

    #[test]
    fn a_failed_statement_keeps_the_transaction_for_its_rollback() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        let token = replica.begin()?;
        replica.run_in(token, insert("one"))?;
        let failed = replica.run_in(token, statement("INSERT INTO nowhere VALUES (1)", vec![]));
        assert!(matches!(failed, Err(ShellError::Sql(_))));
        replica.rollback(token);
        assert_eq!(bodies(&replica)?, Vec::<serde_json::Value>::new());
        Ok(())
    }

    #[test]
    fn a_dropped_token_rolls_back_and_answers_nothing_more() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        let token = replica.begin()?;
        replica.run_in(token, insert("one"))?;
        // the page went away mid-transaction
        replica.abandon();
        assert!(matches!(
            replica.run_in(token, insert("two")),
            Err(ShellError::TransactionGone)
        ));
        assert!(matches!(
            replica.commit(token),
            Err(ShellError::TransactionGone)
        ));
        assert_eq!(bodies(&replica)?, Vec::<serde_json::Value>::new());
        Ok(())
    }

    #[test]
    fn a_transaction_left_waiting_rolls_back() -> ShellResult<()> {
        let (_dir, replica) = opened(Duration::from_millis(50))?;
        let token = replica.begin()?;
        replica.run_in(token, insert("one"))?;
        std::thread::sleep(Duration::from_millis(300));
        assert!(matches!(
            replica.commit(token),
            Err(ShellError::TransactionGone)
        ));
        // the connection is free again: a statement alone lands
        replica.run(&insert("two"))?;
        assert_eq!(bodies(&replica)?, vec![json!("two")]);
        Ok(())
    }

    #[test]
    fn a_newer_begin_lets_the_older_go() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        let older = replica.begin()?;
        replica.run_in(older, insert("one"))?;
        let newer = replica.begin()?;
        replica.run_in(newer, insert("two"))?;
        replica.commit(newer)?;
        assert!(matches!(
            replica.commit(older),
            Err(ShellError::TransactionGone)
        ));
        assert_eq!(bodies(&replica)?, vec![json!("two")]);
        Ok(())
    }

    #[test]
    fn a_statement_alone_waits_out_a_running_transaction() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        let replica = Arc::new(replica);
        let token = replica.begin()?;
        replica.run_in(token, insert("one"))?;
        let reader = Arc::clone(&replica);
        let read = std::thread::spawn(move || bodies(&reader));
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            !read.is_finished(),
            "a read ran inside another's transaction"
        );
        replica.run_in(token, insert("two"))?;
        replica.commit(token)?;
        let seen = read
            .join()
            .map_err(|_| ShellError::Invalid("the reader panicked".to_owned()))??;
        assert_eq!(seen, vec![json!("one"), json!("two")]);
        Ok(())
    }

    #[test]
    fn a_signed_out_replica_answers_nothing() {
        let replica = Replica::new(TRANSACTION_IDLE_LIMIT);
        assert!(matches!(
            replica.all(&statement("SELECT 1", vec![])),
            Err(ShellError::SignedOut)
        ));
        assert!(matches!(replica.begin(), Err(ShellError::SignedOut)));
    }

    #[test]
    fn values_cross_as_the_page_binds_them() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        let rows = replica.all(&statement(
            "SELECT ? AS i, ? AS r, ? AS t, ? AS n, typeof(?) AS kind",
            vec![
                json!(1_700_000_000_000_i64),
                json!(0.5),
                json!("é"),
                serde_json::Value::Null,
                json!(3),
            ],
        ))?;
        assert_eq!(
            serde_json::Value::Object(rows[0].clone()),
            json!({ "i": 1_700_000_000_000_i64, "r": 0.5, "t": "é", "n": null, "kind": "integer" })
        );
        assert!(matches!(
            replica.all(&statement("SELECT ?", vec![json!(true)])),
            Err(ShellError::Invalid(_))
        ));
        Ok(())
    }

    #[test]
    fn a_statement_that_returns_rows_runs_as_one_that_returns_none() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        replica.run(&statement(
            "INSERT INTO notes (body) VALUES ('one') RETURNING id",
            vec![],
        ))?;
        assert_eq!(bodies(&replica)?, vec![json!("one")]);
        Ok(())
    }

    #[test]
    fn full_text_search_is_compiled_in() -> ShellResult<()> {
        let (_dir, replica) = opened(TRANSACTION_IDLE_LIMIT)?;
        replica.run(&statement(
            "CREATE VIRTUAL TABLE search USING fts5(body)",
            vec![],
        ))?;
        replica.run(&statement(
            "INSERT INTO search (body) VALUES ('a reading list')",
            vec![],
        ))?;
        let found = replica.all(&statement(
            "SELECT body FROM search WHERE search MATCH 'reading'",
            vec![],
        ))?;
        assert_eq!(found.len(), 1);
        Ok(())
    }

    #[test]
    fn a_closed_replica_keeps_its_file_for_the_next_open() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("account.sqlite");
        let replica = Replica::new(TRANSACTION_IDLE_LIMIT);
        replica.open(&path)?;
        replica.run(&statement("CREATE TABLE notes (body TEXT)", vec![]))?;
        replica.run(&insert("kept"))?;
        replica.close();
        assert!(matches!(
            replica.run(&insert("lost")),
            Err(ShellError::SignedOut)
        ));
        replica.open(&path)?;
        assert_eq!(
            replica
                .all(&statement("SELECT body FROM notes", vec![]))?
                .len(),
            1
        );
        Ok(())
    }
}
