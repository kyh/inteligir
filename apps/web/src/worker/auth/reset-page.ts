// Cloud-hosted, not a deep link: email clients open browsers, and a reset must work with no
// app installed. One static document with inline CSS/JS: the token never touches the markup
// (the script reads it from location.search), so nothing is reflected and nothing needs escaping.

// client-side sanity only; routes junk URLs to the invalid view instead of a doomed submit
const TOKEN_PATTERN = "^[A-Za-z0-9_-]{8,256}$";

// Better Auth's default minPasswordLength
const MIN_PASSWORD_LENGTH = 8;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Reset password — inteligir</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #fafafa; color: #1a1a1a; }
  main { width: min(20rem, calc(100vw - 3rem)); padding: 2rem; text-align: center; }
  h1 { font-size: 1.05rem; margin: 0 0 1rem; }
  form { display: grid; gap: 0.5rem; text-align: left; }
  label { font-size: 12px; color: #6b6b6b; }
  input { font: inherit; padding: 0.45rem 0.6rem; border: 1px solid #d4d4d4; border-radius: 8px; background: #fff; color: inherit; }
  input:focus { outline: 2px solid #1a1a1a; outline-offset: -1px; }
  button { font: inherit; margin-top: 0.5rem; padding: 0.5rem 1.25rem; border: 0; border-radius: 8px; background: #1a1a1a; color: #fff; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  p.dim { color: #6b6b6b; font-size: 13px; }
  p.error { color: #b3261e; font-size: 13px; min-height: 1.2em; margin: 0.5rem 0 0; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <section id="form-view" hidden>
    <h1>Choose a new password</h1>
    <form id="reset-form">
      <label for="password">New password</label>
      <input id="password" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}">
      <label for="confirm">Confirm password</label>
      <input id="confirm" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}">
      <button id="submit" type="submit">Set new password</button>
    </form>
    <p class="error" id="form-error"></p>
  </section>
  <section id="done-view" hidden>
    <h1>Password changed</h1>
    <p class="dim">Sign in with your new password on your device. You can close this tab.</p>
  </section>
  <section id="invalid-view" hidden>
    <h1>This link is invalid or has expired</h1>
    <p class="dim">Request a new reset link from the inteligir app and try again.</p>
  </section>
</main>
<script>
  "use strict";
  var params = new URLSearchParams(location.search);
  var token = params.get("token");
  var tokenOk = token !== null && new RegExp(${JSON.stringify(TOKEN_PATTERN)}).test(token);
  var show = function (id) {
    ["form-view", "done-view", "invalid-view"].forEach(function (view) {
      document.getElementById(view).hidden = view !== id;
    });
  };
  if (!tokenOk || params.get("error") !== null) {
    show("invalid-view");
  } else {
    show("form-view");
    document.getElementById("reset-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var errorOut = document.getElementById("form-error");
      var password = document.getElementById("password").value;
      if (password !== document.getElementById("confirm").value) {
        errorOut.textContent = "Passwords don't match.";
        return;
      }
      var submit = document.getElementById("submit");
      submit.disabled = true;
      errorOut.textContent = "";
      fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: password, token: token }),
      })
        .then(function (response) {
          if (response.ok) {
            show("done-view");
            return;
          }
          // A rejected token is dead for good (single-use consume) — flip to
          // the invalid-link view rather than inviting a doomed retry.
          if (response.status === 400) {
            show("invalid-view");
            return;
          }
          throw new Error("HTTP " + response.status);
        })
        .catch(function () {
          submit.disabled = false;
          errorOut.textContent = "Something went wrong — try again.";
        });
    });
  }
</script>
</body>
</html>`;

export function handleResetPage(): Response {
  return new Response(PAGE, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // the URL carries a live single-use token
      "cache-control": "no-store",
    },
  });
}
