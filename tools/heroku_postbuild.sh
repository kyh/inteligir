#!/bin/bash
#
# Heroku postbuild script to manage compilation of our JavaScript app and build all necessary
# assets.
#
# Note:
# You can add any additional postbuild methods to this file.

npm run build
