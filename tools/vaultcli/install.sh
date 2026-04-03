#!/usr/bin/env bash
# =============================================================================
#
#  vaultcli installer
#
#  Install:    curl -fsSL https://raw.githubusercontent.com/marinoscar/vault/main/tools/vaultcli/install.sh | bash
#  Update:     vaultcli-update   (alias created during install)
#  Uninstall:  curl -fsSL https://raw.githubusercontent.com/marinoscar/vault/main/tools/vaultcli/install.sh | bash -s -- --uninstall
#
#  Or run locally:
#    ./install.sh
#    ./install.sh --uninstall
#
#  The script is fully idempotent — run it again to update.
#
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_URL="https://github.com/marinoscar/vault.git"
INSTALL_DIR="${VAULTCLI_INSTALL_DIR:-${HOME}/.vaultcli}"
LINK_TARGET="/usr/local/bin/vaultcli"
UPDATE_LINK="/usr/local/bin/vaultcli-update"
MIN_NODE_MAJOR=18
BRANCH="main"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------

if [ -t 1 ] 2>/dev/null; then
  RED='\033[0;31m'    GREEN='\033[0;32m'  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'   BOLD='\033[1m'      DIM='\033[2m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' DIM='' RESET=''
fi

info()    { echo -e "  ${CYAN}●${RESET}  $*"; }
success() { echo -e "  ${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "  ${YELLOW}!${RESET}  $*" >&2; }
fail()    { echo -e "  ${RED}✗${RESET}  $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}$*${RESET}"; }

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--uninstall" ]]; then
  echo ""
  echo -e "${BOLD}vaultcli — Uninstaller${RESET}"
  echo ""

  for f in "${LINK_TARGET}" "${UPDATE_LINK}"; do
    if [ -L "$f" ] || [ -f "$f" ]; then
      sudo rm -f "$f"
      success "Removed $f"
    fi
  done

  if [ -d "${INSTALL_DIR}" ]; then
    echo ""
    info "Repository at ${INSTALL_DIR} was kept."
    info "To remove it:  rm -rf ${INSTALL_DIR}"
  fi

  echo ""
  info "To remove config and auth tokens:"
  echo "    rm -rf ~/.config/vaultcli"
  echo ""
  exit 0
fi

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}  ┌──────────────────────────────┐${RESET}"
echo -e "${BOLD}  │       vaultcli installer      │${RESET}"
echo -e "${BOLD}  └──────────────────────────────┘${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Step 1 — Prerequisites
# ---------------------------------------------------------------------------

step "[1/5] Checking prerequisites"

# git
if ! command -v git &>/dev/null; then
  fail "git is not installed. Install it first:  sudo apt install git"
fi
success "git $(git --version | awk '{print $3}')"

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js ${MIN_NODE_MAJOR}+:\n       https://nodejs.org  or  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
fi

NODE_VERSION="$(node -v | sed 's/^v//')"
NODE_MAJOR="$(echo "${NODE_VERSION}" | cut -d. -f1)"

if [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]; then
  fail "Node.js ${NODE_VERSION} found, but ${MIN_NODE_MAJOR}+ is required."
fi
success "Node.js ${NODE_VERSION}"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm is not installed. It should come with Node.js."
fi
success "npm $(npm -v)"

# ---------------------------------------------------------------------------
# Step 2 — Get the source code
# ---------------------------------------------------------------------------

step "[2/5] Getting source code"

# Detect if running from inside the repo or via curl pipe
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "bash" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# Check if SCRIPT_DIR is inside a valid repo with tools/vaultcli
if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/package.json" ] && [ -f "${SCRIPT_DIR}/bin/vaultcli.js" ]; then
  # Running from inside the repo (local install)
  VAULTCLI_DIR="${SCRIPT_DIR}"
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  info "Running from local repo: ${REPO_ROOT}"

  # Pull latest if this is a git repo
  if [ -d "${REPO_ROOT}/.git" ]; then
    info "Pulling latest changes..."
    (cd "${REPO_ROOT}" && git pull origin "${BRANCH}" 2>&1 | tail -3) || warn "git pull failed — continuing with current code"
    success "Source up to date"
  fi
else
  # Running via curl pipe or from outside the repo — clone to INSTALL_DIR
  REPO_ROOT="${INSTALL_DIR}"
  VAULTCLI_DIR="${INSTALL_DIR}/tools/vaultcli"

  if [ -d "${REPO_ROOT}/.git" ]; then
    info "Existing installation found at ${REPO_ROOT}"
    info "Pulling latest changes..."
    (cd "${REPO_ROOT}" && git fetch origin "${BRANCH}" && git reset --hard "origin/${BRANCH}" 2>&1 | tail -3)
    success "Updated to latest"
  else
    info "Cloning repository to ${REPO_ROOT}..."
    git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${REPO_ROOT}" 2>&1 | tail -3
    success "Cloned"
  fi
fi

# Sanity check
if [ ! -f "${VAULTCLI_DIR}/package.json" ]; then
  fail "package.json not found at ${VAULTCLI_DIR}. Installation may be corrupt."
fi

BIN_SOURCE="${VAULTCLI_DIR}/bin/vaultcli.js"

if [ ! -f "${BIN_SOURCE}" ]; then
  fail "bin/vaultcli.js not found. Installation may be corrupt."
fi

# ---------------------------------------------------------------------------
# Step 3 — Install dependencies
# ---------------------------------------------------------------------------

step "[3/5] Installing dependencies"

if [ -f "${REPO_ROOT}/package.json" ] && grep -q '"workspaces"' "${REPO_ROOT}/package.json" 2>/dev/null; then
  info "Monorepo detected — installing workspace dependencies..."
  (cd "${REPO_ROOT}" && npm install --workspace=tools/vaultcli 2>&1 | tail -3)
else
  (cd "${VAULTCLI_DIR}" && npm install 2>&1 | tail -3)
fi
success "Dependencies installed"

# ---------------------------------------------------------------------------
# Step 4 — Build
# ---------------------------------------------------------------------------

step "[4/5] Building"

(cd "${VAULTCLI_DIR}" && npm run build 2>&1 | tail -3)
success "Build complete"

# Extract version
CLI_VERSION="$(node "${BIN_SOURCE}" --version 2>/dev/null || echo "unknown")"
success "Version: ${CLI_VERSION}"

# ---------------------------------------------------------------------------
# Step 5 — Install globally
# ---------------------------------------------------------------------------

step "[5/5] Installing to ${LINK_TARGET}"

# Ensure the bin script is executable
chmod +x "${BIN_SOURCE}"

# Create or update the main symlink
if [ -L "${LINK_TARGET}" ]; then
  EXISTING="$(readlink -f "${LINK_TARGET}" 2>/dev/null || echo "")"
  if [ "${EXISTING}" = "$(readlink -f "${BIN_SOURCE}")" ]; then
    success "Symlink already correct"
  else
    sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
    success "Symlink updated"
  fi
elif [ -f "${LINK_TARGET}" ]; then
  warn "${LINK_TARGET} exists as a regular file — replacing"
  sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
  success "Symlink created"
else
  sudo ln -sf "${BIN_SOURCE}" "${LINK_TARGET}"
  success "Symlink created"
fi

# Create a convenience `vaultcli-update` command
UPDATER_SCRIPT="${VAULTCLI_DIR}/.vaultcli-update.sh"
cat > "${UPDATER_SCRIPT}" << 'UPDATER'
#!/usr/bin/env bash
# Quick updater — pulls latest and reinstalls
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/install.sh"
UPDATER
chmod +x "${UPDATER_SCRIPT}"
sudo ln -sf "${UPDATER_SCRIPT}" "${UPDATE_LINK}" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

echo ""
if command -v vaultcli &>/dev/null; then
  INSTALLED_VERSION="$(vaultcli --version 2>/dev/null || echo "unknown")"
  success "vaultcli ${INSTALLED_VERSION} is installed and ready"
else
  warn "vaultcli was installed at ${LINK_TARGET} but is not in your PATH"
  warn "Add this to your shell profile:"
  echo '    export PATH="/usr/local/bin:$PATH"'
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}  ┌──────────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │  ${GREEN}✓${RESET}${BOLD}  Installation complete!                    │${RESET}"
echo -e "${BOLD}  └──────────────────────────────────────────────┘${RESET}"
echo ""
echo "  Get started:"
echo ""
echo "    ${DIM}\$${RESET} vaultcli auth login                        ${DIM}# Authenticate${RESET}"
echo "    ${DIM}\$${RESET} vaultcli types list                        ${DIM}# Browse secret types${RESET}"
echo "    ${DIM}\$${RESET} vaultcli secrets create --name \"My Secret\" --type-id <uuid> --data '{\"key\":\"value\"}'  ${DIM}# Create${RESET}"
echo "    ${DIM}\$${RESET} vaultcli secrets list                      ${DIM}# List secrets${RESET}"
echo "    ${DIM}\$${RESET} vaultcli secrets get \"My Secret\"            ${DIM}# Get by name${RESET}"
echo "    ${DIM}\$${RESET} vaultcli --help                            ${DIM}# Show all commands${RESET}"
echo ""
echo "  Update:     ${DIM}vaultcli-update${RESET}  or  ${DIM}curl -fsSL https://raw.githubusercontent.com/marinoscar/vault/main/tools/vaultcli/install.sh | bash${RESET}"
echo "  Uninstall:  ${DIM}${VAULTCLI_DIR}/install.sh --uninstall${RESET}"
echo ""
