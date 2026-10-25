import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><Suspense><SignUp fallbackRedirectUrl="/dashboard" /></Suspense></main>;
}
