import { Platform } from '@prisma/client';
import { parsePlatform, parseLeadUrl } from './url-parser';
import { RawLead } from './types';

/** RFC-4180-style parser: quoted fields, escaped quotes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string> = {
  name: 'name', displayname: 'name', title: 'name', channel: 'name',
  platform: 'platform', network: 'platform',
  handle: 'handle', username: 'handle', user: 'handle',
  url: 'url', link: 'url', profile: 'url', website: 'url',
  followers: 'followers', subscribers: 'followers', subs: 'followers',
  country: 'country', language: 'language', lang: 'language',
  email: 'email', contactemail: 'email',
  bio: 'bio', description: 'bio', about: 'bio',
};

const MAX_ROWS = 2000;

export interface ImportResult {
  leads: RawLead[];
  errors: { row: number; message: string }[];
}

export function leadsFromRecords(records: Record<string, unknown>[], source = 'csv'): ImportResult {
  const leads: RawLead[] = [];
  const errors: ImportResult['errors'] = [];
  if (records.length > MAX_ROWS) errors.push({ row: 0, message: `Only the first ${MAX_ROWS} rows were read.` });

  records.slice(0, MAX_ROWS).forEach((rec, i) => {
    const rowNo = i + 2; // header is row 1
    const get = (k: string) => {
      const v = rec[k];
      return v == null ? '' : String(v).trim();
    };
    const parsedFromUrl = get('url') ? parseLeadUrl(get('url')) : null;
    const platform = (get('platform') ? parsePlatform(get('platform')) : null) ?? parsedFromUrl?.platform ?? null;
    if (!platform) return errors.push({ row: rowNo, message: 'Could not tell the platform — add a platform column or a profile URL.' });

    const handle = (get('handle').replace(/^@/, '').toLowerCase() || parsedFromUrl?.handle || '').slice(0, 100);
    if (!handle) return errors.push({ row: rowNo, message: 'Missing handle (or a URL to read it from).' });

    const followersRaw = get('followers').replace(/[,\s]/g, '');
    const followers = followersRaw === '' ? null : Number(followersRaw);
    if (followers !== null && (!Number.isFinite(followers) || followers < 0)) {
      return errors.push({ row: rowNo, message: `"${get('followers')}" is not a valid follower count.` });
    }
    const email = get('email').toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errors.push({ row: rowNo, message: `"${get('email')}" is not a valid email.` });
    }
    const country = get('country').toUpperCase();
    leads.push({
      platform: platform as Platform,
      handle,
      url: parsedFromUrl?.url ?? get('url') ?? '',
      displayName: (get('name') || handle).slice(0, 120),
      bio: get('bio').slice(0, 3000),
      followers: followers === null ? null : Math.round(followers),
      country: /^[A-Z]{2}$/.test(country) ? country : null,
      language: get('language').slice(0, 40) || null,
      contactEmail: email || null,
      source,
    });
  });
  return { leads, errors };
}

export function leadsFromCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { leads: [], errors: [{ row: 0, message: 'The file needs a header row and at least one lead.' }] };
  const headers = rows[0].map((h) => ALIASES[h.toLowerCase().replace(/[^a-z]/g, '')] ?? '');
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { if (h && r[idx] !== undefined) rec[h] = r[idx]; });
    return rec;
  });
  return leadsFromRecords(records, 'csv');
}
