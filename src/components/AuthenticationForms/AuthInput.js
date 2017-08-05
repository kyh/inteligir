import React from 'react';
const styles = require('./LoginForm.scss');

export default function Input({
// eslint-disable-next-line react/prop-types
  input, label, type, meta: { touched, error }
}) {
  return (
    <section className={styles.loginFormInputWrapper}>
      {
        error && touched &&
          <div className={styles.loginInputErrorMessage}>
            {`*${error}`}
          </div>
      }
      <input
        {...input}
        type={type}
        className={`
          ${styles.loginFormInput}
          ${error && touched ? 'error' : ''}
        `}
        placeholder={label}
      />
    </section>
  );
}
