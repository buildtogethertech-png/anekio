import { Redirect } from "expo-router";
import { AnekioLoader } from "../components/anekio-loader";
import { useSession } from "../lib/session";

export default function Index() {
  const { ready, user } = useSession();
  if (!ready) {
    return <AnekioLoader />;
  }
  return <Redirect href={user ? "/(app)" : "/login"} />;
}
