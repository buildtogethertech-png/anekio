import { getAisensyConfig } from "./aisensy";
import { getResendConfig } from "./resend";

export type PayShareChannelId = "whatsapp" | "email";

export type PayShareChannels = {
  whatsapp: boolean;
  email: boolean;
};

export async function getPayShareChannels(): Promise<PayShareChannels> {
  const [whatsapp, email] = await Promise.all([getAisensyConfig(), getResendConfig()]);
  return {
    whatsapp: whatsapp.configured,
    email: email.configured,
  };
}
