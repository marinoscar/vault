import { isBlockedAddress } from '@marinoscar/platform-api/core';

/**
 * ADR-0006 decision 8: the destination ranges the broker refuses. The check is the platform's
 * `isBlockedAddress` (never a local copy); this table pins that it covers EVERY range the ADR lists,
 * at both edges, plus the mapped and NAT64 forms, so a platform change that narrows it fails here.
 */
describe('isBlockedAddress as the broker needs it (ADR-0006)', () => {
  const blocked: Array<[string, string]> = [
    ['0.0.0.0', '0/8 first'], ['0.255.255.255', '0/8 last'],
    ['10.0.0.0', '10/8 first'], ['10.255.255.255', '10/8 last'],
    ['100.64.0.0', 'CGNAT first'], ['100.127.255.255', 'CGNAT last'],
    ['127.0.0.1', 'loopback'], ['127.255.255.255', 'loopback last'],
    ['169.254.0.0', 'link-local first'], ['169.254.169.254', 'cloud metadata'], ['169.254.255.255', 'link-local last'],
    ['172.16.0.0', '172.16/12 first'], ['172.31.255.255', '172.16/12 last'],
    ['192.0.0.0', '192.0.0/24 first'], ['192.0.0.255', '192.0.0/24 last'],
    ['192.168.0.0', '192.168/16 first'], ['192.168.255.255', '192.168/16 last'],
    ['198.18.0.0', '198.18/15 first'], ['198.19.255.255', '198.18/15 last'],
    ['224.0.0.0', 'multicast first'], ['239.255.255.255', 'multicast last'],
    ['240.0.0.0', 'reserved first'], ['255.255.255.254', 'reserved'], ['255.255.255.255', 'broadcast'],
    ['::', 'IPv6 unspecified'], ['::1', 'IPv6 loopback'],
    ['fc00::', 'ULA first'], ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ULA last'],
    ['fe80::1', 'IPv6 link-local'], ['febf::1', 'link-local last block'],
    ['ff00::', 'IPv6 multicast first'], ['ff02::1', 'IPv6 multicast'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private (dotted)'], ['::ffff:a00:1', 'IPv4-mapped private (hex)'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'], ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['::ffff:0:10.0.0.1', 'IPv4-translated private'],
    ['64:ff9b::a00:1', 'NAT64 of 10.0.0.1'], ['64:ff9b::7f00:1', 'NAT64 of 127.0.0.1'], ['64:ff9b::a9fe:a9fe', 'NAT64 of metadata'], ['64:ff9b::c0a8:1', 'NAT64 of 192.168.0.1'],
    ['::10.0.0.1', 'IPv4-compatible private'],
    ['not-an-address', 'garbage fails closed'], ['1.2.3', 'short dotted fails closed'], ['', 'empty fails closed'],
  ];
  it.each(blocked)('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  const allowed: Array<[string, string]> = [
    ['1.0.0.0', 'first public'], ['8.8.8.8', 'public'], ['93.184.216.34', 'public'],
    ['100.63.255.255', 'just below CGNAT'], ['100.128.0.0', 'just above CGNAT'],
    ['172.15.255.255', 'just below 172.16/12'], ['172.32.0.0', 'just above 172.16/12'],
    ['192.0.1.1', 'just above 192.0.0/24'], ['198.17.255.255', 'just below 198.18/15'], ['198.20.0.0', 'just above 198.18/15'],
    ['223.255.255.255', 'last unicast'],
    ['2606:4700:4700::1111', 'public IPv6'], ['::ffff:8.8.8.8', 'IPv4-mapped public'], ['64:ff9b::808:808', 'NAT64 of 8.8.8.8'],
  ];
  it.each(allowed)('allows %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});
