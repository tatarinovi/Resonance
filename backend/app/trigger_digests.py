import asyncio
import sys
import os
import logging

# Initialize logging to see scheduler info
logging.basicConfig(level=logging.INFO, format='%(message)s')

# Ensure the parent directory (which contains the 'app' package) is in sys.path
# Script is now at: [root]/backend/app/trigger_digests.py
# In Docker: /app/app/trigger_digests.py
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

try:
    from app.scheduler import send_morning_digest, send_evening_digest
    from app.matrix_service import matrix_bot
except ImportError as e:
    print(f"Error importing app modules: {e}")
    print(f"Current sys.path: {sys.path}")
    sys.exit(1)

async def main():
    print("🚀 Initializing Matrix bot for manual digest trigger...")
    try:
        await matrix_bot.login()
        
        # Mandatory sync: need room state
        print("🔄 Performing Matrix sync to fetch room state...")
        await matrix_bot.client.sync(timeout=3000, full_state=True)
        
        print("\n--- [1/2] Triggering Morning Digest (reminders & tags) ---")
        await send_morning_digest()
        
        print("\n--- [2/2] Triggering Evening Digest (stats summary) ---")
        await send_evening_digest()
        
        print("\n✅ Done. Check your Matrix rooms to verify delivery and routing.")
    except Exception as e:
        print(f"❌ Error during execution: {e}")
    finally:
        # matrix-nio clients should be closed if possible, 
        # but here we rely on script termination.
        pass

if __name__ == "__main__":
    asyncio.run(main())
