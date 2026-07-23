# Research Log — Android LAN Access Without Router Changes

Purpose: preserve research findings and sources for Android access to `https://navis.local` on the same Wi‑Fi without router configuration changes.

## Context
- Phone on same Wi‑Fi cannot resolve `navis.local` while direct IP access works.
- Bridge logs show phone reaching the alias IP but no SNI for `navis.local`.

## Snapdrop Architecture (Discovery Without mDNS)
- Snapdrop uses a public rendezvous URL (`snapdrop.net`) to establish WebSocket signaling.
- The server groups peers by source IP to approximate “same Wi‑Fi” discovery.
- Discovery is not based on local DNS/mDNS; it is based on a shared public domain and IP-based rooms.

Sources:
- Snapdrop server code (rooms keyed by `peer.ip`):
  - https://github.com/SnapDrop/snapdrop/blob/master/server/index.js
- Snapdrop README:
  - https://github.com/SnapDrop/snapdrop

## Android NSD (mDNS / DNS‑SD)
- Android provides NSD APIs for apps to discover services over DNS‑SD.
- NSD is app‑level discovery; browsers do not automatically use NSD for `.local` resolution.
- Android NSD API is limited to local network discovery over Multicast DNS (mDNS).

Sources:
- Android NSD docs:
  - https://developer.android.com/develop/connectivity/wifi/use-nsd
  - https://developer.android.com/reference/android/net/nsd/NsdManager

## Android Private DNS (System DNS Override)
- Android exposes a “Private DNS” setting that expects a **provider hostname**.
- This setting is global for the device and not per‑domain.

Sources:
- Google support on Private DNS (provider hostname):
  - https://support.google.com/android/answer/9654714
  - https://support.google.com/android/answer/9089903

## DNS‑SD / mDNS RFCs (Background)
- DNS‑SD defined by RFC 6763.
- mDNS defined by RFC 6762.
- RFC 6762 specifies that `.local` names are link‑local and that queries for `.local` MUST be sent to the mDNS multicast address.
- RFC 8375 reserves `home.arpa.` for residential homenets and states queries should be resolved by local resolvers (not forwarded outside).

Sources:
- RFC 6763: https://datatracker.ietf.org/doc/html/rfc6763
- RFC 6762: https://datatracker.ietf.org/doc/html/rfc6762
  - https://www.rfc-editor.org/rfc/rfc6762.txt (Section 3: `.local` and mDNS multicast requirement)
 - RFC 8375: https://www.rfc-editor.org/rfc/rfc8375.txt

Excerpt (RFC 6762):
- “Any DNS query for a name ending with `.local.` MUST be sent to the mDNS IPv4 link-local multicast address 224.0.0.251 (or its IPv6 equivalent FF02::FB).”
- “If a user types `http://MyPrinter.local.` into their web browser… then the protocol has met the user's needs in this case.” (illustrates `.local` browser usage via mDNS resolver)

Excerpt (RFC 8375):
- “DNS queries for names ending with `.home.arpa.` are resolved using local resolvers on the homenet. Such queries MUST NOT be recursively forwarded to servers outside the logical boundaries of the homenet.”

Implication (needs validation on Android):
- If the platform resolver doesn’t implement mDNS for `.local`, a browser relying on the system resolver will not resolve `navis.local`.

## Current Observations (Local Tests)
- Phone reaches alias IP (bridge logs show `tls_no_sni` from phone IP).
- No `navis.local` SNI seen from phone, suggesting name resolution failure.
- Direct IP works: `https://<alias-ip>/status` responds from daemon.

## Open Research Threads
- Validate Android browser `.local` behavior across OEMs/Chrome versions.
- Investigate whether Android Chrome honors mDNS in any configurations.
- Explore Android‑friendly discovery that does not require router changes.
- Determine whether Android system resolver supports mDNS for `.local` and if any system‑level switches exist.
- Verify if a minimal on‑device DNS profile (DoT/DoH) can be installed without a pre‑existing public hostname.

## Android mDNS Support Variance (Device Resolver Package)
- Some devices may not have the resolver module that includes mDNS support.
- An accepted Stack Overflow answer indicates Samsung Galaxy S10 `.local` resolution failure traced to missing `com.google.android.resolv` package; suggested check:
  - adb shell dumpsys package com.google.android.resolv

Source:
- Stack Overflow (Stackprinter):
  - https://stackprinter.appspot.com/export?question=74773081&service=stackoverflow&language=en&width=640

Implication:
- Android `.local` mDNS support may depend on device/resolver package availability; not guaranteed across OEMs.

## Android `.local` Resolution via Router DNS (Not mDNS)
- A recent Stack Overflow accepted answer reports `.local` works on one network but not another because the router’s DNS resolves it; with Private DNS enabled, resolution fails (suggesting no mDNS fallback on that device).
- This implies some Android environments rely on router DNS or DHCP‑provided DNS rather than mDNS for `.local`.

Source:
- Stack Overflow (Stackprinter):
  - https://stackprinter.appspot.com/export?question=79405699&service=stackoverflow&language=en&width=640

Implication:
- Router DNS behavior can make `.local` appear to “work” on Android, but it is not reliable without router support.

## Android Resolver mDNS Flag (Anecdotal)
- A Stack Overflow answer claims Android resolver sets an mDNS flag when hostname ends with `.local` and `mdns_resolution` experiment flag is enabled.
- Not a canonical spec; treat as anecdotal and verify against AOSP source if needed.

Source:
- Stack Overflow (Stackprinter):
  - https://stackprinter.appspot.com/export?question=40806141&service=stackoverflow&language=en&width=640

## AOSP Resolver Code (mDNS Flag, Transport Rules, Multicast Targets)
- Android DNS resolver sets mDNS only when:
  - hostname ends with `.local`
  - network supports mDNS
  - `mdns_resolution` experiment flag is enabled
- mDNS is disabled on cellular and VPN transport types.
- Resolver sends mDNS to `ff02::fb:5353` and `224.0.0.251:5353`.
- `mdns_resolution` experiment flag is read via `GetServerConfigurableFlag("netd_native", ...)`.

Sources (AOSP DnsResolver module):
- `setMdnsFlag` in `gethnamaddr.cpp`:
  - https://android.googlesource.com/platform/packages/modules/DnsResolver/+/refs/heads/main/gethnamaddr.cpp
- mDNS transport constraints in `res_cache.cpp`:
  - https://android.googlesource.com/platform/packages/modules/DnsResolver/+/refs/heads/main/res_cache.cpp
- mDNS multicast targets in `res_send.cpp`:
  - https://android.googlesource.com/platform/packages/modules/DnsResolver/+/refs/heads/main/res_send.cpp
- Experiment flag retrieval in `util.cpp`:
  - https://android.googlesource.com/platform/packages/modules/DnsResolver/+/refs/heads/main/util.cpp

## Chromium Host Resolver Behavior (System Resolver for .local)
- Chromium uses the system resolver (`getaddrinfo`) for address resolves when hostname ends with `.local`.
- The system resolver may query DNS, hosts, and sometimes mDNS depending on OS capabilities.
- Chromium mDNS source is only used for non‑address requests when hostname ends with `.local` (so address resolution relies on system resolver behavior).

Source:
- Chromium net/dns README:
  - https://chromium.googlesource.com/chromium/src/+/main/net/dns/README.md

## Android Multicast Reception Requirement (App Level)
- Android Wi‑Fi stack filters multicast by default; apps must acquire a `MulticastLock` to receive multicast packets.

Source:
- Android WifiManager.MulticastLock docs:
  - https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock

Implication:
- Even if mDNS is supported, apps must explicitly opt in to receive multicast; browsers likely do not.


## Android NSD (Alternate Source URL)
- Additional Android NSD guide confirms DNS‑SD use for service discovery by apps.
- Emphasizes NSD is for app discovery, not browser hostname resolution.

Source:
- https://developer.android.com/develop/connectivity/wifi/use-nsd

## Chromium/Browser mDNS (Attempted Sources)
- Attempted to access Chromium network stack mDNS docs; Gitiles access requires sign‑in and returns NOT_FOUND for anonymous requests.
- Could not retrieve mDNS policy details from Chromium docs in this session.

Attempted sources (blocked):
- https://chromium.googlesource.com/chromium/src/+/main/docs/network-stack/mdns.md
- https://chromium.googlesource.com/chromium/src/+/main/net/docs/dns.md

## Chromium Certificate Name Matching (SAN Requirement)
- Chrome removed fallback to Common Name matching; SAN must be present for hostname/IP matching.

Source:
- Chrome 58 deprecations blog:
  - https://developer.chrome.com/blog/chrome-58-deprecations/

Excerpt (Chrome 58):
- Chrome matches names using `subjectAlternativeName` and removed fallback to `commonName`.

Implication:
- Any local cert intended for Chromium‑based browsers must include SANs for `navis.local` and any IP‑based fallback.

## Android Open Source Project DNS Docs (Attempted Sources)
- AOSP DNS/Private DNS docs returned 404 via jina.ai mirror during this session.

Attempted sources (404 via mirror):
- https://source.android.com/docs/core/connect/dns-resolver
- https://source.android.com/docs/core/connect/dns-private-dns
- https://source.android.com/docs/core/connect/dns

Attempted sources (404 direct):
- https://source.android.com/docs/core/connect/dns-resolver
- https://source.android.com/docs/core/connect/dns-private-dns

## AOSP Mainline DNS Resolver Docs (Not Readable via Curl)
- The Mainline DNS Resolver pages appear to be JS-rendered; curl did not surface the content in this session.

Attempted sources (JS-rendered):
- https://source.android.com/docs/core/ota/modular-system/dns-resolver
- https://source.android.com/docs/core/ota/modular-system

## Search Engine Access (Blocked)
- Bing search via jina.ai returned 451 (blocked due to anonymous access restrictions).

Attempted sources (blocked):
- https://www.bing.com/search?q=Chrome+Android+mdns+.local+resolution
- https://www.bing.com/search?q=Android+Chrome+local+hostname+mdns
- https://www.bing.com/search?q=Android+Chrome+mdns+support+local+domain
- https://www.bing.com/search?q=Private+DNS+Android+hostname+requirement

## DuckDuckGo Search (Blocked by Anomaly Check)
- DuckDuckGo HTML endpoint returned an anomaly/JS challenge when accessed via curl, so results could not be parsed in this session.

Attempted source (blocked):
- https://duckduckgo.com/html/?q=Android+Chrome+mdns+local+hostname+resolution
