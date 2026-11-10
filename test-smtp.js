import dotenv from 'dotenv';
dotenv.config();
import nodemailer from 'nodemailer';

async function testSmtp() {
  console.log('--------------------------------------------------');
  console.log('Testing SMTP connection with settings from .env:');
  console.log('Host    :', process.env.MAIL_HOST);
  console.log('Port    :', process.env.MAIL_PORT);
  console.log('User    :', process.env.MAIL_USERNAME);
  console.log('From    :', process.env.MAIL_FROM_ADDRESS);
  console.log('Pass len:', process.env.MAIL_PASSWORD ? process.env.MAIL_PASSWORD.length : 0);
  console.log('--------------------------------------------------');

  if (!process.env.MAIL_PASSWORD || process.env.MAIL_PASSWORD === '********') {
    console.warn('⚠️ WARNING: MAIL_PASSWORD in .env is still set to placeholder "********".');
    console.warn('Please paste your real ZeptoMail password/API key in .env and run this test again.\n');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.zeptomail.in',
    port: parseInt(process.env.MAIL_PORT || '587', 10),
    secure: process.env.MAIL_PORT === '465',
    auth: {
      user: process.env.MAIL_USERNAME || 'emailapikey',
      pass: process.env.MAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting and verifying credentials with SMTP server...');
    await transporter.verify();
    console.log('✅ SUCCESS! SMTP connected and authenticated successfully.');

    const targetEmail = process.argv[2];
    if (targetEmail) {
      console.log(`Sending test email to ${targetEmail}...`);
      const info = await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME || 'Example Team'}" <${process.env.MAIL_FROM_ADDRESS || 'noreply@ekaryam.io'}>`,
        to: targetEmail,
        subject: 'Test Email from Karyam',
        html: '<div style="font-family:sans-serif;padding:20px;"><h2>Test Email</h2><p>Test email sent successfully via ZeptoMail SMTP.</p></div>',
      });
      console.log('✅ Test email sent successfully! MessageId:', info.messageId);
    } else {
      console.log('\n💡 Tip: To send an actual test email, run:');
      console.log('   node test-smtp.js your-email@gmail.com');
    }
  } catch (err) {
    console.error('\n❌ SMTP Verification failed:');
    console.error(err.message);
  }
}

testSmtp();

