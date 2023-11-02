import type { Options } from "nodemailer/lib/smtp-transport";
import { configuration } from "@/lib/configuration";

type SendEmailParams = {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export const sendEmail = async (config: SendEmailParams) => {
  const transporter = await getSMTPTransporter();

  return transporter.sendMail(config);
};

/**
 * SMTP Transporter for production use. Add your favorite email
 * API details (Mailgun, Sendgrid, etc.) to the configuration.
 */
const getSMTPTransporter = async () => {
  const nodemailer = await import("nodemailer");

  return nodemailer.createTransport(getSMTPConfiguration());
};

const getSMTPConfiguration = (): Options => {
  if (configuration.production) {
    return getProductionSMTPConfiguration();
  }

  return getInBucketSMTPConfiguration();
};

const getProductionSMTPConfiguration = () => {
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

  return {
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  };
};

const getInBucketSMTPConfiguration = () => ({
  host: "0.0.0.0",
  port: 54325,
  secure: false,
  auth: {},
});
