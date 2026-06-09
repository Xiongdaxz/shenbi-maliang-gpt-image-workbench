import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import ConfigApp from "./ConfigApp";
import { clearPromptTemplateFormDraftCache } from "./lib/promptTemplateDraftCache";
import "./styles.css";
import "./styles/login.css";
import "./styles/shared-ui.css";
import "./styles/search-history.css";
import "./styles/app-shell.css";
import "./styles/chat-messages.css";
import "./styles/image-editor.css";
import "./styles/starter-composer.css";
import "./styles/material-picker.css";
import "./styles/overlays.css";
import "./styles/pages.css";
import "./styles/cards-timeline.css";
import "./styles/image-preview.css";
import "./styles/asset-library.css";
import "./styles/prompt-templates.css";
import "./styles/image-download-menu.css";
import "./styles/config.css";
import "./styles/settings-dialog.css";
import "./styles/responsive.css";
import "./styles/appearance.css";

clearPromptTemplateFormDraftCache();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/config/*" element={<ConfigApp />} />
          <Route path="/*" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
