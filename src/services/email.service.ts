import nodemailer from 'nodemailer';
import {config, logger} from '@config/index';

// Tests never send mail: jsonTransport only serialises the message.
const transport =
    config.env === 'test'
        ? nodemailer.createTransport({jsonTransport: true})
        : nodemailer.createTransport(config.email.smtp);

if (config.env !== 'test') {
    transport
        .verify()
        .then(() => logger.info('Connected to email server'))
        .catch(() =>
            logger.warn(
                'Unable to connect to email server. Make sure you have configured the SMTP options in .env',
            ),
        );
}

/**
 * Send an email
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} [html] - Optional HTML content for the email
 * @param {Array<Object>} [attachments] - Optional attachments for the email
 * @returns {Promise}
 */
const sendEmail = async (
    to: string,
    subject: string,
    text: string,
    html?: string,
    attachments?: Array<{filename: string; path: string}>,
) => {
    const msg = {
        from: config.email.from,
        to,
        subject,
        text,
        html, // Allows sending emails with HTML content
        attachments, // Allows sending emails with attachments
    };
    await transport.sendMail(msg);
};

/** Reset link carries a single-use opaque token (only its hash is stored). */
const sendResetPasswordEmail = async (to: string, token: string) => {
    try {
        const url = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
        const text = `To reset your KiranaOS password, open this link: ${url}
It expires in ${config.jwt.resetPasswordExpirationMinutes} minutes. If you did not ask for this, ignore this email.`;
        const html = `<p>To reset your KiranaOS password, <a href="${url}">click here</a>.</p><p>The link expires in ${config.jwt.resetPasswordExpirationMinutes} minutes. If you did not ask for this, ignore this email.</p>`;
        await sendEmail(to, 'Reset your KiranaOS password', text, html);
        return {success: true};
    } catch (error) {
        logger.error(`Failed to send reset password email: ${error}`);
        return {success: false};
    }
};

/** Links always point at APP_URL; callers cannot choose the redirect target. */
const sendVerificationEmail = async (to: string, username: string, code: string) => {
    try {
        const url = `${config.appUrl}/verify?username=${encodeURIComponent(username)}&code=${code}`;
        const text = `Your KiranaOS verification code is ${code}. Or open: ${url}`;
        const html = `<p>Your KiranaOS verification code is <b>${code}</b>.</p><p>Or <a href="${url}">verify your email</a>.</p>`;
        await sendEmail(to, 'Verify your KiranaOS email', text, html);
        return {success: true};
    } catch (error) {
        logger.error(`Failed to send verification email: ${error}`);
        return {success: false};
    }
};

export default {
    transport,
    sendEmail,
    sendResetPasswordEmail,
    sendVerificationEmail,
};
