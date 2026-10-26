import { folderConnector } from "./impl/folder";
import { postgresConnector } from "./impl/postgres";
import { websiteConnector } from "./impl/website";
import type { ConnectorImpl } from "./types";

/** Only connectors that are built AND tested appear here. */
export const IMPLEMENTATIONS: Record<string, ConnectorImpl> = {
  document_folder: folderConnector,
  postgres_database: postgresConnector,
  website_scanner: websiteConnector,
};
