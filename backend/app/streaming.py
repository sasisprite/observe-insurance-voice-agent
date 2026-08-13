import asyncio
import json
from typing import AsyncGenerator

async def event_generator(session_id: str, initial_event: dict) -> AsyncGenerator[str, None]:
    yield f"data: {json.dumps(initial_event)}\n\n"
    # Heartbeat / update stream simulation for graph state
    for i in range(1, 4):
        await asyncio.sleep(1)
        yield f"data: {json.dumps({'sessionId': session_id, 'sequence': i, 'status': 'streaming'})}\n\n"
