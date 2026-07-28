#!/bin/bash

# Exit on error
set -e

# Check platform
platform=$(uname)

if [[ "$platform" == "Darwin" ]]; then
    echo "Running on macOS. Note that the AppImage created will only work on Linux systems."
    if ! command -v docker &> /dev/null; then
        echo "Docker Desktop for Mac is not installed. Please install it from https://www.docker.com/products/docker-desktop"
        exit 1
    fi
elif [[ "$platform" == "Linux" ]]; then
    echo "Running on Linux. Proceeding with AppImage creation..."
else
    echo "This script is intended to run on macOS or Linux. Current platform: $platform"
    exit 1
fi

# Enable BuildKit
export DOCKER_BUILDKIT=1

BUILD_IMAGE_NAME="orin-appimage-builder"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

# Check and install Buildx if needed
if ! docker buildx version >/dev/null 2>&1; then
    echo "Installing Docker Buildx..."
    mkdir -p ~/.docker/cli-plugins/
    curl -SL https://github.com/docker/buildx/releases/download/v0.13.1/buildx-v0.13.1.linux-amd64 -o ~/.docker/cli-plugins/docker-buildx
    chmod +x ~/.docker/cli-plugins/docker-buildx
fi

# Download appimagetool if not present
if [ ! -f "appimagetool" ]; then
    echo "Downloading appimagetool..."
    wget -O appimagetool "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x appimagetool
fi

# Delete any existing AppImage to avoid bloating the build
rm -f Orin-x86_64.AppImage

# Create build Dockerfile
echo "Creating build Dockerfile..."
cat > Dockerfile.build << 'EOF'
# syntax=docker/dockerfile:1
FROM ubuntu:20.04

# Install required dependencies
RUN apt-get update && apt-get install -y \
    libfuse2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libnss3 \
    libasound2 \
    libdrm2 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EOF

# Create .dockerignore file
echo "Creating .dockerignore file..."
cat > .dockerignore << EOF
Dockerfile.build
.dockerignore
.git
.gitignore
.DS_Store
*~
*.swp
*.swo
*.tmp
*.bak
*.log
*.err
node_modules/
venv/
*.egg-info/
*.tox/
dist/
EOF

# Build Docker image without cache
echo "Building Docker image (no cache)..."
docker build --no-cache -t "$BUILD_IMAGE_NAME" -f Dockerfile.build .

# Create AppImage using local appimagetool
echo "Creating AppImage..."
docker run --rm --privileged -v "$(pwd):/app" "$BUILD_IMAGE_NAME" bash -c '
cd /app && \
rm -rf OrinApp.AppDir && \
mkdir -p OrinApp.AppDir/usr/bin OrinApp.AppDir/usr/lib OrinApp.AppDir/usr/share/applications && \
find . -maxdepth 1 ! -name OrinApp.AppDir ! -name "." ! -name ".." -exec cp -r {} OrinApp.AppDir/usr/bin/ \; && \
cp orin.png OrinApp.AppDir/ && \
echo "[Desktop Entry]" > OrinApp.AppDir/orin.desktop && \
echo "Name=Orin" >> OrinApp.AppDir/orin.desktop && \
echo "Comment=Open source AI code editor." >> OrinApp.AppDir/orin.desktop && \
echo "GenericName=Text Editor" >> OrinApp.AppDir/orin.desktop && \
echo "Exec=void %F" >> OrinApp.AppDir/orin.desktop && \
echo "Icon=void" >> OrinApp.AppDir/orin.desktop && \
echo "Type=Application" >> OrinApp.AppDir/orin.desktop && \
echo "StartupNotify=false" >> OrinApp.AppDir/orin.desktop && \
echo "StartupWMClass=Orin" >> OrinApp.AppDir/orin.desktop && \
echo "Categories=TextEditor;Development;IDE;" >> OrinApp.AppDir/orin.desktop && \
echo "MimeType=application/x-orin-workspace;" >> OrinApp.AppDir/orin.desktop && \
echo "Keywords=void;" >> OrinApp.AppDir/orin.desktop && \
echo "Actions=new-empty-window;" >> OrinApp.AppDir/orin.desktop && \
echo "[Desktop Action new-empty-window]" >> OrinApp.AppDir/orin.desktop && \
echo "Name=New Empty Window" >> OrinApp.AppDir/orin.desktop && \
echo "Name[de]=Neues leeres Fenster" >> OrinApp.AppDir/orin.desktop && \
echo "Name[es]=Nueva ventana vacía" >> OrinApp.AppDir/orin.desktop && \
echo "Name[fr]=Nouvelle fenêtre vide" >> OrinApp.AppDir/orin.desktop && \
echo "Name[it]=Nuova finestra vuota" >> OrinApp.AppDir/orin.desktop && \
echo "Name[ja]=新しい空のウィンドウ" >> OrinApp.AppDir/orin.desktop && \
echo "Name[ko]=새 빈 창" >> OrinApp.AppDir/orin.desktop && \
echo "Name[ru]=Новое пустое окно" >> OrinApp.AppDir/orin.desktop && \
echo "Name[zh_CN]=新建空窗口" >> OrinApp.AppDir/orin.desktop && \
echo "Name[zh_TW]=開新空視窗" >> OrinApp.AppDir/orin.desktop && \
echo "Exec=void --new-window %F" >> OrinApp.AppDir/orin.desktop && \
echo "Icon=void" >> OrinApp.AppDir/orin.desktop && \
chmod +x OrinApp.AppDir/orin.desktop && \
cp OrinApp.AppDir/orin.desktop OrinApp.AppDir/usr/share/applications/ && \
echo "[Desktop Entry]" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "Name=Orin - URL Handler" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "Comment=Open source AI code editor." > OrinApp.AppDir/orin-url-handler.desktop && \
echo "GenericName=Text Editor" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "Exec=void --open-url %U" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "Icon=void" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "Type=Application" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "NoDisplay=true" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "StartupNotify=true" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "Categories=Utility;TextEditor;Development;IDE;" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "MimeType=x-scheme-handler/void;" > OrinApp.AppDir/orin-url-handler.desktop && \
echo "Keywords=void;" > OrinApp.AppDir/orin-url-handler.desktop && \
chmod +x OrinApp.AppDir/orin-url-handler.desktop && \
cp OrinApp.AppDir/orin-url-handler.desktop OrinApp.AppDir/usr/share/applications/ && \
echo "#!/bin/bash" > OrinApp.AppDir/AppRun && \
echo "HERE=\$(dirname \"\$(readlink -f \"\${0}\")\")" >> OrinApp.AppDir/AppRun && \
echo "export PATH=\${HERE}/usr/bin:\${PATH}" >> OrinApp.AppDir/AppRun && \
echo "export LD_LIBRARY_PATH=\${HERE}/usr/lib:\${LD_LIBRARY_PATH}" >> OrinApp.AppDir/AppRun && \
echo "exec \${HERE}/usr/bin/void --no-sandbox \"\$@\"" >> OrinApp.AppDir/AppRun && \
chmod +x OrinApp.AppDir/AppRun && \
chmod -R 755 OrinApp.AppDir && \

# Strip unneeded symbols from the binary to reduce size
strip --strip-unneeded OrinApp.AppDir/usr/bin/void

ls -la OrinApp.AppDir/ && \
ARCH=x86_64 ./appimagetool -n OrinApp.AppDir Orin-x86_64.AppImage
'

# Clean up
rm -rf OrinApp.AppDir .dockerignore appimagetool

echo "AppImage creation complete! Your AppImage is: Orin-x86_64.AppImage"
