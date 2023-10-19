type SendEmailParams = {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export const sendEmail = async (config: SendEmailParams) => {
  const transporter = await getTransporter();

  return transporter.sendMail(config);
};

const getTransporter = () => {
  if (isTest()) {
    return getMockMailTransporter();
  }

  if (process.env.NODE_ENV !== "production") {
    return getEtherealMailTransporter();
  }

  return getSMTPTransporter();
};

/**
 * SMTP Transporter for production use. Add your favorite email
 * API details (Mailgun, Sendgrid, etc.) to the configuration.
 */
const getSMTPTransporter = async () => {
  const nodemailer = await import("nodemailer");

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT);

  const secure = port === 465 && !configuration.production;

  // validate that we have all the required configuration
  if (!user || !pass || !host || !port) {
    throw new Error(
      `Missing email configuration. Please add the following environment variables:
      EMAIL_USER
      EMAIL_PASSWORD
      EMAIL_HOST
      EMAIL_PORT
      `,
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

/**
 * @description Dev transport for https://ethereal.email that you can use to
 * debug your emails for free. It's the default for the dev environment
 */
const getEtherealMailTransporter = async () => {
  const nodemailer = await import("nodemailer");
  const testAccount = await getEtherealTestAccount();

  const host = "smtp.ethereal.email";
  const port = 587;

  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
};

const getMockMailTransporter = () => ({
  sendMail: (params: SendEmailParams) => {
    console.log(
      `Using mock email transporter with params`,
      JSON.stringify(params, null, 2),
    );
  },
});

const getEtherealTestAccount = async () => {
  const user = process.env.ETHEREAL_EMAIL;
  const pass = process.env.ETHEREAL_PASSWORD;

  // if we have added an Ethereal account, we reuse these credentials to
  // send the email
  if (user && pass) {
    console.log(`Sending email with Ethereal test account...`);

    return {
      user,
      pass,
    };
  }

  // Otherwise, we create a new account and recommend to add the credentials
  // to the configuration file
  return createEtherealTestAccount();
};

const createEtherealTestAccount = async () => {
  const nodemailer = await import("nodemailer");
  const newAccount = await nodemailer.createTestAccount();

  console.warn(`
    Configuration property "emailEtherealTestAccount" was not found! 
    Consider adding a fixed Ethereal account so that you don't need to update the credentials each time you use it.
    To do so, please use the guide at https://makerkit.dev/docs/email
  `);

  console.log(
    `Created Ethereal test account: ${JSON.stringify(newAccount, null, 2)}`,
  );

  console.log(`Consider adding these credentials to your configuration file`);

  return newAccount;
};

const isTest = () => process.env.IS_CI === "true";
