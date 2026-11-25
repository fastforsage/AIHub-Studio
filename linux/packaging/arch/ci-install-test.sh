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

installed_files="$(pacman -Qlq "$package_name")"
printf '%s\n' "$installed_files"

if ! printf '%s\n' "$installed_files" | grep -Fqx '/usr/share/applications/aihub-studio.desktop'; then
  printf 'The AIHub Studio desktop entry was not installed\n' >&2
  exit 1
fi

if ! printf '%s\n' "$installed_files" | grep -E '/aihub-studio$'; then
  printf 'The AIHub Studio executable was not installed\n' >&2
  exit 1
fi

printf 'Arch package installation check passed for %s\n' "$package_name"
