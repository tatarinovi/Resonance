import sys
import os

# Ensure the parent directory (which contains the 'app' package) is in sys.path
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

import subprocess

def check():
    uid = os.getuid() if hasattr(os, 'getuid') else 'N/A'
    gid = os.getgid() if hasattr(os, 'getgid') else 'N/A'
    print(f"UID/GID: {uid}/{gid}")
    
    paths = ["/data"]
    for path in paths:
        exists = os.path.exists(path)
        print(f"Path {path} exists: {exists}")
        if exists:
            stat = os.stat(path)
            print(f"  Mode: {oct(stat.st_mode)}")
            print(f"  Owner: {stat.st_uid}:{stat.st_gid}")
            if os.path.isdir(path):
                print(f"  Contents: {os.listdir(path)}")
            
            # Try to write a test file
            test_file = os.path.join(path, ".test_write")
            try:
                with open(test_file, "w") as f:
                    f.write("test")
                print(f"  Write test: SUCCESS")
                os.remove(test_file)
            except Exception as e:
                print(f"  Write test: FAILED ({e})")
        else:
            # Try to create it if it doesn't exist
            try:
                os.makedirs(path, exist_ok=True)
                print(f"  Creation test: SUCCESS")
            except Exception as e:
                print(f"  Creation test: FAILED ({e})")

if __name__ == "__main__":
    check()
