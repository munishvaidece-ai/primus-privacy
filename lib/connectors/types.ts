export type Sensitivity = "unclassified" | "none" | "personal" | "sensitive";

export interface DiscoveredAsset {
  assetType: string;
  name: string;
  location: string;
  attributes: Record<string, unknown>;
  piiCategories: string[];
  sensitivity: Sensitivity;
}

export interface ConnectorContext {
  config: Record<string, unknown>;
  secret: Record<string, string> | null;
  env: NodeJS.ProcessEnv;
}

export interface TestResult { ok: boolean; message: string }
export interface ScanResult { assets: DiscoveredAsset[]; stats: Record<string, number | string> }

export interface ConnectorImpl {
  test(ctx: ConnectorContext): Promise<TestResult>;
  scan(ctx: ConnectorContext): Promise<ScanResult>;
}
