import sys
import os

# Ensure the parent directory (which contains the 'app' package) is in sys.path
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

from app.database import SessionLocal
from app.models import Project, Ticket, TicketStatus
from sqlalchemy import select, func

def dump():
    with SessionLocal() as db:
        print("--- Projects ---")
        projects = db.scalars(select(Project)).all()
        for p in projects:
            print(f"ID: {p.id}, Name: {p.name}")
            config = p.config_json or {}
            print(f"  Morning Digest: {config.get('morning_digest_enabled')}")
            print(f"  Evening Digest: {config.get('evening_digest_enabled')}")
            print(f"  Expert Rooms: {config.get('expert_rooms')}")
            
        print("\n--- FORWARDED Tickets Detail ---")
        forwarded = db.scalars(select(Ticket).where(Ticket.status == TicketStatus.FORWARDED)).all()
        if not forwarded:
            print("  No forwarded tickets found.")
        for t in forwarded:
            direction = t.data_json.get("target_direction")
            expert = t.data_json.get("target_expert")
            epic = t.data_json.get("epic_name")
            print(f"  ID: {t.id}, project: {t.project_id}, direction: '{direction}', expert: '{expert}', epic: '{epic}'")

        print("\n--- All Ticket Status Counts ---")
        counts = db.query(Ticket.status, func.count(Ticket.id)).group_by(Ticket.status).all()
        for status, count in counts:
            print(f"  {status}: {count}")

if __name__ == "__main__":
    dump()
