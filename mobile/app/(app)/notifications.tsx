import { Redirect } from "expo-router";

// Notifications now live in the header bell popover. Keep old links harmless.
export default function NotificationsRedirect() {
  return <Redirect href="/" />;
}
