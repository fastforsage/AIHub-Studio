export type AvailabilityStatus = "available" | "slow" | "protected" | "regional-restriction" | "unavailable";
export type RegionStatus = "allowed" | "restricted" | "unknown" | "not-applicable";
export interface ServiceAvailabilityResult { providerId: string; status: AvailabilityStatus; regionStatus: RegionStatus; checkedAt: string; latencyMs: number | null; httpStatus: number | null; finalUrl: string | null; message: string; regionNote: string | null; }
export interface ServiceAvailabilityReport { checkedAt: string; detectedCountryCode: string | null; detectedCountryName: string | null; regionDetection: "ip-geolocation" | "unavailable"; results: ServiceAvailabilityResult[]; }
export interface ServiceAvailabilityApi { checkCatalog(): Promise<ServiceAvailabilityReport>; }
