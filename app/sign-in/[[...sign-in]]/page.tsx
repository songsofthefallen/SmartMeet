import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return <main className="flex min-h-screen items-center justify-center p-6"><Suspense><SignIn /></Suspense></main>;
}
