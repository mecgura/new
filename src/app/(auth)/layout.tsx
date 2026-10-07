import { Logo } from "@/components/layout/logo";
import { ToastProvider } from "@/components/ds";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="app-root dark flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <main id="main-content" className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
