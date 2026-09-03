import json, sys

def run(args):
    return {"processed": True, "raw": args.get("payload")}

if __name__ == "__main__":
    raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
    try:
        parsed = json.loads(raw)
        print(json.dumps(run(parsed)))
    except Exception as e:
        print(json.dumps({"error": str(e)}))