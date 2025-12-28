# SmartLand AI Microservice - GeoTrendSync Algorithm

## Overview
The AI microservice implements the proprietary **GeoTrendSync algorithm** for Philippine real estate analysis. It provides intelligent predictions for price per square meter (PHP/sqm) and growth potential, identifying "hidden gems" in the real estate market.

## Features

### 🧠 Core Algorithm (GeoTrendSync)
- **Price Prediction**: XGBoost-based model for accurate PHP/sqm predictions
- **Growth Scoring**: K-Means clustering for investment category classification
- **Philippine-Specific Features**: Typhoon risk, proximity to amenities, economic indicators
- **NLP Analysis**: 
  - spaCy for entity extraction (locations, organizations)
  - Transformers pipeline for sentiment analysis
  - News text analysis for infrastructure development detection

### 📊 Data Sources
- **OpenStreetMap (OSM)**: Geospatial data for amenities, roads, land use
- **Philippine News Sources**: Infrastructure announcements and development news
- **Economic Indicators**: GDP growth, population growth, employment data
- **Real Estate Data**: Price trends, market analysis

### 🎯 Investment Categories
- **A+ (Prime Investment)**: High-growth zones with mega-projects
- **A to B+ (High Growth)**: Moderate growth with planned infrastructure
- **B to C (Moderate Growth)**: Emerging areas with potential but higher risk
- **C- (High Risk)**: Low growth, minimal infrastructure development

## Installation

### 1. Create Virtual Environment
```bash
cd ai-microservice
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Install spaCy Model (for NLP)
```bash
python -m spacy download en_core_web_sm
```

### 4. Run the Service
```bash
uvicorn geotrend:app --reload --port 8000
```

**Note**: The service uses `geotrend.py` as the main application file. On first run, models will be automatically trained and saved to the `models/` directory.

## API Endpoints

### POST /predict
Main prediction endpoint for GeoTrendSync analysis.

**Request Body:**
```json
{
  "distance_to_amenities": 5.0,
  "population_growth": 3.5,
  "gdp_growth": 5.0,
  "infrastructure_score": 8.0,
  "typhoon_risk": 2.0,
  "proximity_to_mall": 2.0,
  "proximity_to_school": 1.5,
  "proximity_to_hospital": 3.0,
  "news_text": "New airport project announced in Quezon City..."
}
```

**Response:**
```json
{
  "predicted_price_sqm": 4500.25,
  "category": "A+ (Prime Investment)",
  "growth_score": 85.5,
  "insights": "High-end area with premium pricing | Exceptional growth potential - prime investment opportunity | Strong economic fundamentals support growth",
  "news_analysis": {
    "sentiment": "positive",
    "entities": [{"text": "Quezon City", "type": "GPE"}],
    "insights": ["Airport/transportation development"]
  },
  "feature_analysis": {
    "amenity_score": 7.2,
    "economic_score": 4.4,
    "risk_score": 2.8
  }
}
```

### GET /health
Health check endpoint.

### GET /models/info
Information about loaded ML models.

**Response:**
```json
{
  "price_model": "XGBoost Regressor",
  "growth_model": "K-Means Clustering",
  "scaler": "StandardScaler",
  "nlp_model": "spaCy en_core_web_sm"
}
```

## Data Collectors

### OSM Data Collector (`data_collectors/osm_collector.py`)
Collects geospatial data from OpenStreetMap:
- Amenities (malls, schools, hospitals)
- Land use information
- Transportation infrastructure
- Proximity calculations

### News Data Collector (`data_collectors/news_collector.py`)
Scrapes Philippine news sources for:
- Infrastructure announcements
- Development projects
- Economic news
- Sentiment analysis

## Model Training

The GeoTrendSync algorithm automatically trains models on startup if pre-trained models don't exist:

1. **Price Prediction Model**: XGBoost regressor trained on Philippine real estate data
2. **Growth Classification Model**: K-Means clustering for investment categories
3. **Feature Engineering**: Philippine-specific features (typhoon risk, proximity scores)

### Model Persistence
- Models are automatically saved to the `models/` directory after training
- On subsequent runs, pre-trained models are loaded automatically
- To retrain models, delete the `models/` directory and restart the service

### Training Data Features
- Distance to amenities (km)
- Population growth (%)
- GDP growth (%)
- Infrastructure score (0-10)
- Typhoon risk (0-10)
- Proximity to malls, schools, hospitals
- Economic indicators

## Integration with Backend

The AI microservice integrates with the main backend:

1. **Backend calls**: `POST http://localhost:8000/predict`
2. **Response processing**: Backend combines AI predictions with database data
3. **Report generation**: Comprehensive investment analysis

## Example Usage

### Python Client
```python
import requests

# Predict for Metro Manila
data = {
    "distance_to_amenities": 5.0,
    "population_growth": 3.5,
    "gdp_growth": 5.0,
    "infrastructure_score": 8.0,
    "typhoon_risk": 2.0,
    "proximity_to_mall": 2.0,
    "proximity_to_school": 1.5,
    "proximity_to_hospital": 3.0,
    "news_text": "New airport project announced in Quezon City with P50B investment."
}

response = requests.post("http://localhost:8000/predict", json=data)
result = response.json()
print(f"Predicted Price: PHP {result['predicted_price_sqm']}/sqm")
print(f"Category: {result['category']}")
print(f"Growth Score: {result['growth_score']}%")
```

### cURL
```bash
curl -X POST "http://localhost:8000/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "distance_to_amenities": 5.0,
    "population_growth": 3.5,
    "gdp_growth": 5.0,
    "infrastructure_score": 8.0,
    "typhoon_risk": 2.0,
    "proximity_to_mall": 2.0,
    "proximity_to_school": 1.5,
    "proximity_to_hospital": 3.0,
    "news_text": "New airport project announced in Quezon City."
  }'
```

## Configuration

### Environment Variables
Create `.env` file:
```
MODEL_PATH=models/
LOG_LEVEL=INFO
NEWS_SOURCES=philstar,inquirer,rappler
OSM_TIMEOUT=25
```

### Model Files
Models are saved in `models/` directory:
- `price_model.pkl`: XGBoost price prediction model
- `growth_model.pkl`: K-Means growth classification model
- `scaler.pkl`: Feature scaling parameters

**Note**: NLP models (spaCy and transformers) are loaded from their respective libraries and don't require separate model files.

## Development

### Adding New Features
1. **New Data Sources**: Add collectors in `data_collectors/`
2. **Model Improvements**: Modify `GeoTrendSync` class in `geotrend.py`
3. **API Extensions**: Add new endpoints in `geotrend.py`

### Testing
```bash
# Test the prediction endpoint
python -c "
import requests
response = requests.post('http://localhost:8000/predict', json={
    'distance_to_amenities': 5.0,
    'population_growth': 3.5,
    'gdp_growth': 5.0,
    'infrastructure_score': 8.0,
    'typhoon_risk': 2.0
})
print(response.json())
"
```

## Performance

- **Prediction Time**: < 100ms per request
- **Model Loading**: ~2 seconds on startup
- **Memory Usage**: ~500MB with all models loaded
- **Concurrent Requests**: Supports 100+ requests per minute

## Troubleshooting

### Common Issues

1. **spaCy Model Not Found**
   ```bash
   python -m spacy download en_core_web_sm
   ```

2. **Model Training Fails**
   - Check disk space in `models/` directory
   - Verify Python dependencies are installed (especially `xgboost`, `scikit-learn`, `joblib`)
   - Ensure `transformers` library is installed for sentiment analysis
   - Check that `spacy` model is downloaded: `python -m spacy download en_core_web_sm`

3. **OSM API Timeout**
   - Increase timeout in `osm_collector.py`
   - Check internet connection

4. **Memory Issues**
   - Reduce model complexity in `GeoTrendSync.train_models()` in `geotrend.py`
   - Use smaller training datasets
   - Transformers sentiment analysis may require additional memory (~500MB)

5. **XGBoost or Transformers Import Errors**
   ```bash
   pip install xgboost transformers torch
   ```

6. **Models Not Loading**
   - Check that `models/` directory exists and contains `.pkl` files
   - Verify file permissions for model files
   - Models will auto-train on first run if not found

## License
Proprietary - SmartLand GeoTrendSync Algorithm 