#!/bin/bash

# Simple commit script for site changes

# Stage all changes
git add -A

# Commit with a message (use argument if provided, otherwise prompt)
if [ -z "$1" ]; then
  echo "what do you want to commit?:"
  read message
else
  message="$1"
fi

git commit -m "$message"

# Ask if you want to push
read -p "Push to remote? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  git push
fi
