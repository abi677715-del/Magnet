import { Platform } from '@prisma/client';

export interface RawLead {
  platform: Platform;
  handle: string;
  url: string;
  displayName: string;
  bio?: string;
  followers?: number | null;
  country?: string | null;
  language?: string | null;
  contactEmail?: string | null;
  recentContent?: { title?: string; text?: string; url?: string; publishedAt?: string }[];
  topics?: string[];
  source: string;
}
