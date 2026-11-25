#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "Updating Arch package database and installing base-devel..."
pacman -Syu --noconfirm base-devel

build_dir="$(mktemp -d /tmp/aihub-studio-pkg-XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT

cp /packagesrc/PKGBUILD "$build_dir/PKGBUILD"
cp /packagesrc/aihub-studio-0.1.0-linux-x86_64.tar.gz "$build_dir/"

if ! id builder >/dev/null 2>&1; then
  useradd --create-home builder
fi
chown -R builder:builder "$build_dir"

printf '%s\n' "Building native pacman package with makepkg..."
su -s /bin/bash builder -c "cd '$build_dir' && makepkg --noconfirm --nodeps"

shopt -s nullglob
packages=("$build_dir"/*.pkg.tar.zst)
if (( ${#packages[@]} != 1 )); then
  printf 'Expected exactly one package, found %s\n' "${#packages[@]}" >&2
  ls -la "$build_dir" >&2
  exit 1
fi

package="${packages[0]}"
package_name="$(pacman -Qp "$package" | awk '{print $1}')"
source "$build_dir/PKGBUILD"
pacman -S --noconfirm --needed "${depends[@]}"
printf '%s\n' "Installing ${package_name} through pacman..."
pacman -U --noconfirm "$package"
pacman -Q "$package_name"

installed_files="$(pacman -Qlq "$package_name")"
printf '%s\n' "$installed_files"

if ! printf '%s\n' "$installed_files" | grep -Fqx '/usr/share/applications/aihub-studio.desktop'; then
  printf '%s\n' "The AIHub Studio desktop entry was not installed" >&2
  exit 1
fi

if ! printf '%s\n' "$installed_files" | grep -Fqx '/usr/bin/aihub-studio'; then
  printf '%s\n' "The AIHub Studio launcher was not installed" >&2
  exit 1
fi

if ! printf '%s\n' "$installed_files" | grep -Fqx '/opt/aihub-studio/aihub-studio'; then
  printf '%s\n' "The bundled Electron executable was not installed" >&2
  exit 1
fi

cp "$package" /packages/out/
printf 'Native Arch package build and installation check passed: %s\n' "$(basename "$package")"
