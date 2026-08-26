import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { constants, publicEncrypt } from 'node:crypto';

const defaultCertificatePath = resolve(process.cwd(), 'ProductionCertificate .cer');

export function generateSecurityCredential(
  certificatePath = defaultCertificatePath,
): string {
  const initiatorPassword = process.env.MPESA_INITIATOR_PASSWORD;

  if (!initiatorPassword) {
    throw new Error('MPESA_INITIATOR_PASSWORD is not configured');
  }

  const certificate = readFileSync(certificatePath);
  const encryptedPassword = publicEncrypt(
    {
      key: certificate,
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(initiatorPassword, 'utf8'),
  );

  const securityCredential = encryptedPassword.toString('base64');
  return securityCredential;
}