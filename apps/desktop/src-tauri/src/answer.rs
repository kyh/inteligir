//! What a command that can be refused answers, parsed by the page against `answerSchema`
//! (`apps/desktop/src/shell-answer.ts`): `{ ok: true }`, with the state the page adopts when there
//! is one, or `{ ok: false, reason }` in the shell's words. A refusal crosses as a value; a command
//! that can fail only by a fault answers a `Result` instead, and its `Err` rejects.

use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer<T = ()> {
    Done(T),
    Refused(String),
}

impl<T> Answer<T> {
    pub fn refused(reason: impl Into<String>) -> Self {
        Self::Refused(reason.into())
    }
}

impl<T> From<Result<T, String>> for Answer<T> {
    fn from(result: Result<T, String>) -> Self {
        match result {
            Ok(state) => Self::Done(state),
            Err(reason) => Self::Refused(reason),
        }
    }
}

/// What a done answer hands the page beside `ok`: a state it adopts, or, for `()`, nothing, since
/// the page's schema for that answer has no `state` to read.
pub trait Payload: Serialize {
    const STATE: bool = true;
}

impl Payload for () {
    const STATE: bool = false;
}

impl<T: Payload> Serialize for Answer<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Done(state) => {
                let mut answer =
                    serializer.serialize_struct("Answer", if T::STATE { 2 } else { 1 })?;
                answer.serialize_field("ok", &true)?;
                if T::STATE {
                    answer.serialize_field("state", state)?;
                }
                answer.end()
            }
            Self::Refused(reason) => {
                let mut answer = serializer.serialize_struct("Answer", 2)?;
                answer.serialize_field("ok", &false)?;
                answer.serialize_field("reason", reason)?;
                answer.end()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    impl Payload for u8 {}

    fn wire<T: Payload>(answer: &Answer<T>) -> Value {
        serde_json::to_value(answer).unwrap_or_default()
    }

    #[test]
    fn crosses_as_the_page_parses_it() {
        assert_eq!(wire(&Answer::Done(())), json!({ "ok": true }));
        assert_eq!(wire(&Answer::Done(1_u8)), json!({ "ok": true, "state": 1 }));
        assert_eq!(
            wire(&Answer::<u8>::refused("no")),
            json!({ "ok": false, "reason": "no" })
        );
    }

    #[test]
    fn a_failed_step_is_its_refusal() {
        assert_eq!(
            Answer::from(Err::<(), _>("gone".to_owned())),
            Answer::refused("gone")
        );
        assert_eq!(Answer::from(Ok::<_, String>(())), Answer::Done(()));
    }
}
