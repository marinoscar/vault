import { describe, expect, it } from 'vitest';

import {
  matchOrigin,
  normalizeOrigin,
  originsFromCredential,
  registrableDomainOfOrigin,
} from '../src/secrets/index.js';

describe('normalizeOrigin', () => {
  it.each([
    ['https://App.Example.TEST/login?x=1#f', 'https://app.example.test'],
    ['  example.test  ', 'https://example.test'],
    ['https://example.test:443/a', 'https://example.test'],
    ['https://example.test:8443/a', 'https://example.test:8443'],
    ['https://user:pw@example.test/', 'https://example.test'],
    ['https://bücher.example.test', 'https://xn--bcher-kva.example.test'],
    ['http://localhost:3000/x', 'http://localhost:3000'],
    ['http://127.0.0.1', 'http://127.0.0.1'],
    ['http://[::1]:8080/', 'http://[::1]:8080'],
    ['http://example.test', null],
    ['ftp://example.test', null],
    ['javascript:alert(1)', null],
    ['', null],
    ['   ', null],
    ['not a url', null],
    ['https://', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });
});

describe('originsFromCredential', () => {
  it('combines, normalizes, dedupes and sorts', () => {
    expect(
      originsFromCredential({
        url: 'https://b.example.test/x',
        additional_urls: 'https://a.example.test\r\n\nB.example.test\nhttp://nope.example.test',
      }),
    ).toEqual(['https://a.example.test', 'https://b.example.test']);
  });
  it('splits on whitespace, commas and semicolons', () => {
    expect(
      originsFromCredential({ additional_urls: 'c.example.test, b.example.test;a.example.test  d.example.test,,' }),
    ).toEqual(['https://a.example.test', 'https://b.example.test', 'https://c.example.test', 'https://d.example.test']);
  });
  it('handles missing and non-string fields', () => {
    expect(originsFromCredential({})).toEqual([]);
    expect(originsFromCredential({ url: 5, additional_urls: null })).toEqual([]);
  });
  it('caps at 20', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `h${String(i).padStart(2, '0')}.example.test`);
    expect(originsFromCredential({ additional_urls: lines.join('\n') })).toHaveLength(20);
  });
});

describe('matchOrigin', () => {
  it('exact', () => {
    expect(matchOrigin('https://App.example.test/p', ['https://app.example.test'])).toEqual({ matchKind: 'exact' });
  });
  it('site by eTLD+1', () => {
    expect(matchOrigin('https://a.example.test', ['https://b.example.test'])).toEqual({ matchKind: 'site' });
  });
  it('multi-label public suffix', () => {
    expect(matchOrigin('https://a.example.co.uk', ['https://b.example.co.uk'])).toEqual({ matchKind: 'site' });
    expect(matchOrigin('https://a.example.co.uk', ['https://other.co.uk'])).toBeNull();
  });
  it('private public suffix is not a site', () => {
    expect(matchOrigin('https://x.github.io', ['https://y.github.io'])).toBeNull();
  });
  it('different schemes or ports are not exact but share a site', () => {
    expect(matchOrigin('https://example.test:8443', ['https://example.test'])).toEqual({ matchKind: 'site' });
  });
  it('no site for IPs, localhost or invalid input', () => {
    expect(matchOrigin('http://127.0.0.1:1', ['http://127.0.0.1:2'])).toBeNull();
    expect(matchOrigin('http://localhost:1', ['http://localhost:2'])).toBeNull();
    expect(matchOrigin('nope nope', ['https://example.test'])).toBeNull();
    expect(registrableDomainOfOrigin('https://x.github.io')).toBe('x.github.io');
  });
  it('unrelated', () => {
    expect(matchOrigin('https://example.test', ['https://example.org'])).toBeNull();
  });
});
