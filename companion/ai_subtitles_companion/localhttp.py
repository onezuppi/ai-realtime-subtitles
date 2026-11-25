"""HTTP client for the local model servers: never through a proxy, never redirected to another address.

The stock urllib opener reads HTTP_PROXY and the system proxy settings. Without a bypass for 127.0.0.1 that sends
audio and text to the proxy, which is what the bridge exists to avoid.
"""
from __future__ import annotations

import urllib.request


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # the redirect answer is raised as an HTTPError instead of being followed


opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
