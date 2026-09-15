import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider, useStore } from "@/lib/store";
import { ThemeProvider } from "@/lib/theme";
import { RensoApp } from "./RensoApp";
import { SignInPage } from "./screens/SignInRenso";

const queryClient = new QueryClient();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useStore();
  if (!isAuthenticated) return <SignInPage />;
  return <>{children}</>;
}

/**
 * ThemeProvider sits *above* the auth gate on purpose: the sign-in screen is
 * part of the product, so it has to honour the saved theme and be able to
 * change it, rather than waiting for a session before colour works.
 */
const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <StoreProvider>
        <TooltipProvider>
          <Toaster />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route
                path="/*"
                element={
                  <AuthGate>
                    <RensoApp />
                  </AuthGate>
                }
              />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </StoreProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
