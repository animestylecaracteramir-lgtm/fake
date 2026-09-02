import sys
import json

def run(args):
    val = float(args.get("value", 0))
    from_unit = args.get("from_unit", "celsius").lower()
    to_unit = args.get("to_unit", "fahrenheit").lower()
    
    # Convert to Celsius first
    if from_unit in ["c", "celsius"]:
        c = val
    elif from_unit in ["f", "fahrenheit"]:
        c = (val - 32) * 5 / 9
    elif from_unit in ["k", "kelvin"]:
        c = val - 273.15
    else:
        return {"error": f"Unsupported unit: {from_unit}"}
        
    # Convert from Celsius to target
    if to_unit in ["c", "celsius"]:
        res = c
    elif to_unit in ["f", "fahrenheit"]:
        res = (c * 9 / 5) + 32
    elif to_unit in ["k", "kelvin"]:
        res = c + 273.15
    else:
        return {"error": f"Unsupported unit: {to_unit}"}
        
    return {"result": round(res, 2), "from_unit": from_unit, "to_unit": to_unit, "original_value": val}

if __name__ == "__main__":
    raw = sys.argv[1] if len(sys.argv) > 1 else "{}"
    try:
        parsed = json.loads(raw)
        out = run(parsed)
        print(json.dumps(out))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
