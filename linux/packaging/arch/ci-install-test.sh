#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob
packages=(/packages/*.pacman /packages/*.pkg.tar.zst)

if (( ${#packages[@]} != 1 )); then
  printf 'Expected exactly one Arch package, found %s\n' "${#packages[@]}" >&2
  printf 'Package directory contents:\n' >&2
  ls -la /packages >&2
  exit 1
fi

package="${packages[0]}"
printf 'Installing package: %s\n' "$package"

pacman -Sy --noconfirm
pacman -U --noconfirm "$package"

package_name="$(pacman -Qp "$package" | awk '{print $1}')"
pacman -Q "$package_name"

installed_files="$(pacman -Ql "$package_name")"
printf '%s\n' "$installed_files" | grep -E '/usr/share/applications/[^ ]+\.desktop$'
printf '%s\n' "$installed_files" | grep -E '/opt/[^ ]*/aihub-studio$'

printf 'Arch package installation check passed for %s\n' "$package_name"
