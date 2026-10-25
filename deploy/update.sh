#!/bin/sh
# Code-only auto-update for the tsuki-re web port.
# Pulls the player code; the unpacked media (assets/, scenes/) lives on
# the media domain and is never touched here. The code domain serves
# everything with no-cache, so players get the new build on next load.
set -e
cd /var/www/tsuki-re/code
git pull --ff-only
