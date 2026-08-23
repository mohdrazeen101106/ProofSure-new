/** Measured Terrain landing experience — the app remains intentionally single-route and content-led. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import ClientPortal from "./pages/ClientPortal";
import HospitalPortal from "./pages/HospitalPortal";
import Home from "./pages/Home";
import ProviderPortal from "./pages/ProviderPortal";
import AuthPage from "./pages/AuthPage";
import AccessDenied from "./pages/AccessDenied";
import { AuthProvider } from "./contexts/AuthContext";
import RoleGate from "./components/RoleGate";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login">{() => <AuthPage mode="login" />}</Route>
      <Route path="/signup">{() => <AuthPage mode="signup" />}</Route>
      <Route path="/access-denied" component={AccessDenied} />
      <Route path="/client">{() => <RoleGate role="client"><ClientPortal /></RoleGate>}</Route>
      <Route path="/hospital">{() => <RoleGate role="hospital"><HospitalPortal /></RoleGate>}</Route>
      <Route path="/provider">{() => <RoleGate role="provider"><ProviderPortal /></RoleGate>}</Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
