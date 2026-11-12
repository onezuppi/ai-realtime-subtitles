"""Companion program for the AI Realtime Subtitles extension.

It starts llama.cpp servers for speech recognition and translation and relays the extension's
requests to them through Native Messaging (works where the browser blocks localhost, for example
in Tor windows).
"""

HOST_NAME = "com.ai_realtime_subtitles.companion"
