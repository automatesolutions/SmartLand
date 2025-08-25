import jwt
import os
from datetime import datetime, timedelta

# Use the same secret as in your .env file
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key")

# Create a test payload
payload = {
    "user_id": "test_user",
    "email": "test@smartland.com",
    "role": "investor",
    "exp": datetime.utcnow() + timedelta(hours=24)  # Token expires in 24 hours
}

# Generate the token
token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")

print("=== TEST JWT TOKEN ===")
print(f"Token: {token}")
print("\n=== HOW TO USE ===")
print("Add this header to your API requests:")
print(f"Authorization: Bearer {token}")
print("\n=== CURL EXAMPLE ===")
print(f'curl -X POST "http://127.0.0.1:8000/api/analyze" \\')
print('  -H "Content-Type: application/json" \\')
print(f'  -H "Authorization: Bearer {token}" \\')
print('  -d "{\\"location\\": \\"Metro Manila\\", \\"data\\": {\\"distance_to_amenities\\": 5.0, \\"population_growth\\": 3.5, \\"gdp_growth\\": 5.0, \\"infrastructure_score\\": 8.0, \\"typhoon_risk\\": 2.0}}"') 