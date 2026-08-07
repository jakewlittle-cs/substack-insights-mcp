import { loadConfig, type AppConfig } from "./config.js";
import { Store } from "./database.js";
import { AnalyticsService } from "./services/analytics-service.js";
import { ContentService } from "./services/content-service.js";

export interface Application {
  config: AppConfig;
  store: Store;
  content: ContentService;
  analytics: AnalyticsService;
  close(): void;
}

export function createApplication(config: AppConfig = loadConfig()): Application {
  const store = new Store(config.dbPath);
  const content = new ContentService(store, config);
  const analytics = new AnalyticsService(store);
  return {
    config,
    store,
    content,
    analytics,
    close: () => store.close(),
  };
}
