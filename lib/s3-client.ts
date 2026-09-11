import { S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

let cachedClient: S3Client | null = null;
let cachedConfig = "";

export function uploadsDriver() {
  return String(process.env.UPLOADS_DRIVER || "local").trim().toLowerCase();
}

export function usesS3Uploads() {
  return uploadsDriver() === "s3";
}

export function awsRegion() {
  return String(process.env.AWS_REGION || "ap-south-1").trim();
}

export function s3Client() {
  const region = awsRegion();
  const roleArn = String(process.env.AWS_ROLE_ARN || "").trim();
  const configKey = `${region}:${roleArn}`;
  if (cachedClient && cachedConfig === configKey) return cachedClient;

  cachedConfig = configKey;
  cachedClient = new S3Client({
    region,
    ...(roleArn
      ? {
          credentials: awsCredentialsProvider({
            roleArn,
            roleSessionName: "anekio-uploads",
            clientConfig: { region },
          }),
        }
      : {}),
  });
  return cachedClient;
}
