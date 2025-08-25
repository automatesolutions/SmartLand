import os
import asyncio
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from loguru import logger
import joblib
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
import spacy
from transformers import pipeline
import requests
import json
from datetime import datetime, timedelta
import geopandas as gpd
from shapely.geometry import Point
import folium

load_dotenv()

app = FastAPI(title="SmartLand AI Microservice", version="1.0.0")

# Logging setup
logger.add("ai_error.log", level="ERROR")
logger.add("ai_combined.log", level="INFO")

# Load spaCy model for NLP
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    logger.warning("spaCy model not found. Install with: python -m spacy download en_core_web_sm")
    nlp = None

# Initialize sentiment analysis
try:
    sentiment_pipeline = pipeline("sentiment-analysis")
except Exception as e:
    logger.warning(f"Sentiment analysis not available: {e}")
    sentiment_pipeline = None

class GeoTrendSync:
    def __init__(self):
        self.price_model = None
        self.growth_model = None
        self.scaler = StandardScaler()
        self.load_or_train_models()
        
    def load_or_train_models(self):
        """Load pre-trained models or train new ones with Philippine data"""
        try:
            # Try to load existing models
            self.price_model = joblib.load('models/price_model.pkl')
            self.growth_model = joblib.load('models/growth_model.pkl')
            self.scaler = joblib.load('models/scaler.pkl')
            logger.info("Loaded pre-trained models")
        except FileNotFoundError:
            logger.info("Training new models with Philippine data")
            self.train_models()
    
    def train_models(self):
        """Train models with Philippine real estate data"""
        # Sample Philippine real estate data (replace with real data)
        data = pd.DataFrame({
            'distance_to_amenities': [5, 10, 2, 15, 8, 12, 3, 20, 7, 25],
            'population_growth': [3.5, 2.0, 4.0, 1.5, 3.0, 2.5, 4.5, 1.0, 3.2, 1.8],
            'gdp_growth': [5.0, 3.0, 6.0, 2.0, 4.5, 3.5, 6.5, 1.5, 4.8, 2.5],
            'infrastructure_score': [8, 4, 9, 3, 7, 5, 9.5, 2, 7.5, 3.5],
            'typhoon_risk': [2, 5, 1, 6, 3, 4, 1.5, 7, 2.5, 5.5],
            'proximity_to_mall': [2, 8, 1, 10, 4, 6, 1.5, 12, 3, 9],
            'proximity_to_school': [1, 5, 2, 8, 3, 4, 1.5, 10, 2.5, 7],
            'proximity_to_hospital': [3, 7, 2, 9, 4, 6, 2.5, 11, 3.5, 8],
            'price_sqm': [5000, 3000, 7000, 2000, 4500, 3500, 7500, 1500, 4800, 2800]
        })
        
        # Prepare features for price prediction
        feature_columns = ['distance_to_amenities', 'population_growth', 'gdp_growth', 
                          'infrastructure_score', 'typhoon_risk', 'proximity_to_mall', 
                          'proximity_to_school', 'proximity_to_hospital']
        
        X = data[feature_columns]
        y_price = data['price_sqm']
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Train price prediction model (XGBoost for better performance)
        self.price_model = xgb.XGBRegressor(
            n_estimators=100,
            learning_rate=0.1,
            max_depth=6,
            random_state=42
        )
        self.price_model.fit(X_scaled, y_price)
        
        # Train growth scoring model (clustering)
        self.growth_model = KMeans(n_clusters=4, random_state=42)
        self.growth_model.fit(X_scaled)
        
        # Save models
        os.makedirs('models', exist_ok=True)
        joblib.dump(self.price_model, 'models/price_model.pkl')
        joblib.dump(self.growth_model, 'models/growth_model.pkl')
        joblib.dump(self.scaler, 'models/scaler.pkl')
        
        logger.info("Models trained and saved successfully")
    
    def extract_news_insights(self, news_text: str) -> dict:
        """Extract insights from news text using NLP"""
        if not news_text or not nlp:
            return {"sentiment": "neutral", "entities": [], "insights": "No news data available"}
        
        doc = nlp(news_text)
        
        # Extract entities (locations, organizations, etc.)
        entities = []
        for ent in doc.ents:
            if ent.label_ in ['GPE', 'LOC', 'ORG']:  # Geographic, Location, Organization
                entities.append({"text": ent.text, "type": ent.label_})
        
        # Sentiment analysis
        sentiment = "neutral"
        if sentiment_pipeline:
            try:
                result = sentiment_pipeline(news_text[:512])  # Limit length
                sentiment = result[0]['label'].lower()
            except Exception as e:
                logger.warning(f"Sentiment analysis failed: {e}")
        
        # Extract key insights
        insights = []
        if "infrastructure" in news_text.lower():
            insights.append("Infrastructure development mentioned")
        if "airport" in news_text.lower() or "airport" in news_text.lower():
            insights.append("Airport/transportation development")
        if "mall" in news_text.lower() or "commercial" in news_text.lower():
            insights.append("Commercial development")
        if "school" in news_text.lower() or "education" in news_text.lower():
            insights.append("Educational facilities")
        
        return {
            "sentiment": sentiment,
            "entities": entities,
            "insights": insights
        }
    
    def calculate_philippine_specific_features(self, data: dict) -> dict:
        """Calculate Philippine-specific features for analysis"""
        features = {
            'distance_to_amenities': data.get('distance_to_amenities', 0),
            'population_growth': data.get('population_growth', 0),
            'gdp_growth': data.get('gdp_growth', 0),
            'infrastructure_score': data.get('infrastructure_score', 0),
            'typhoon_risk': data.get('typhoon_risk', 0),
            'proximity_to_mall': data.get('proximity_to_mall', 5),  # Default 5km
            'proximity_to_school': data.get('proximity_to_school', 3),  # Default 3km
            'proximity_to_hospital': data.get('proximity_to_hospital', 4),  # Default 4km
        }
        
        # Calculate composite scores
        features['amenity_score'] = (
            (10 - features['proximity_to_mall']) * 0.4 +
            (10 - features['proximity_to_school']) * 0.3 +
            (10 - features['proximity_to_hospital']) * 0.3
        )
        
        features['economic_score'] = (
            features['population_growth'] * 0.4 +
            features['gdp_growth'] * 0.6
        )
        
        features['risk_score'] = features['typhoon_risk'] * 0.7 + (10 - features['infrastructure_score']) * 0.3
        
        return features
    
    def predict_price_and_growth(self, data: dict) -> dict:
        """Predict price per sqm and growth potential"""
        # Calculate features
        features = self.calculate_philippine_specific_features(data)
        
        # Prepare feature vector
        feature_columns = ['distance_to_amenities', 'population_growth', 'gdp_growth', 
                          'infrastructure_score', 'typhoon_risk', 'proximity_to_mall', 
                          'proximity_to_school', 'proximity_to_hospital']
        
        feature_vector = np.array([[
            features['distance_to_amenities'],
            features['population_growth'],
            features['gdp_growth'],
            features['infrastructure_score'],
            features['typhoon_risk'],
            features['proximity_to_mall'],
            features['proximity_to_school'],
            features['proximity_to_hospital']
        ]])
        
        # Scale features
        feature_vector_scaled = self.scaler.transform(feature_vector)
        
        # Predict price
        predicted_price = self.price_model.predict(feature_vector_scaled)[0]
        
        # Predict growth cluster
        growth_cluster = self.growth_model.predict(feature_vector_scaled)[0]
        
        # Map clusters to categories
        categories = {
            0: 'A+ (Prime Investment)',
            1: 'A to B+ (High Growth)',
            2: 'B to C (Moderate Growth)',
            3: 'C- (High Risk)'
        }
        
        category = categories.get(growth_cluster, 'Unknown')
        
        # Calculate growth score (0-100)
        growth_score = 100 - (growth_cluster * 25) + np.random.normal(0, 5)  # Add some variance
        growth_score = max(0, min(100, growth_score))
        
        return {
            'predicted_price_sqm': round(predicted_price, 2),
            'category': category,
            'growth_score': round(growth_score, 2),
            'features': features
        }

# Initialize GeoTrendSync
geotrendsync = GeoTrendSync()

# Pydantic models for API
class PredictionRequest(BaseModel):
    distance_to_amenities: float = 0
    population_growth: float = 0
    gdp_growth: float = 0
    infrastructure_score: float = 0
    typhoon_risk: float = 0
    proximity_to_mall: float = 5
    proximity_to_school: float = 3
    proximity_to_hospital: float = 4
    news_text: str = ""

@app.post("/predict")
async def predict(request: PredictionRequest):
    """Main prediction endpoint for GeoTrendSync algorithm"""
    try:
        # Get predictions
        predictions = geotrendsync.predict_price_and_growth(request.dict())
        
        # Extract news insights
        news_insights = geotrendsync.extract_news_insights(request.news_text)
        
        # Generate comprehensive insights
        insights = generate_insights(predictions, news_insights, request.dict())
        
        result = {
            "predicted_price_sqm": predictions['predicted_price_sqm'],
            "category": predictions['category'],
            "growth_score": predictions['growth_score'],
            "insights": insights,
            "news_analysis": news_insights,
            "feature_analysis": predictions['features']
        }
        
        logger.info(f"Prediction completed: {result['category']} - {result['predicted_price_sqm']} PHP/sqm")
        return result
        
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

def generate_insights(predictions: dict, news_insights: dict, data: dict) -> str:
    """Generate human-readable insights"""
    insights = []
    
    # Price insights
    price = predictions['predicted_price_sqm']
    if price > 6000:
        insights.append("High-end area with premium pricing")
    elif price > 4000:
        insights.append("Mid-range area with good value potential")
    elif price > 2000:
        insights.append("Affordable area with growth potential")
    else:
        insights.append("Budget-friendly area, consider development timeline")
    
    # Growth insights
    growth_score = predictions['growth_score']
    if growth_score > 80:
        insights.append("Exceptional growth potential - prime investment opportunity")
    elif growth_score > 60:
        insights.append("Strong growth indicators - recommended for investment")
    elif growth_score > 40:
        insights.append("Moderate growth potential - suitable for long-term investment")
    else:
        insights.append("Higher risk area - requires careful due diligence")
    
    # Economic insights
    if data.get('gdp_growth', 0) > 5:
        insights.append("Strong economic fundamentals support growth")
    if data.get('population_growth', 0) > 3:
        insights.append("Population growth indicates increasing demand")
    
    # Infrastructure insights
    if data.get('infrastructure_score', 0) > 7:
        insights.append("Excellent infrastructure supports property values")
    elif data.get('infrastructure_score', 0) < 4:
        insights.append("Infrastructure development needed - monitor progress")
    
    # Risk insights
    if data.get('typhoon_risk', 0) > 5:
        insights.append("High typhoon risk - consider insurance and building standards")
    
    # News insights
    if news_insights.get('insights'):
        insights.extend(news_insights['insights'])
    
    return " | ".join(insights) if insights else "Standard market conditions"

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "models_loaded": geotrendsync.price_model is not None,
        "timestamp": datetime.now().isoformat()
    }

@app.get("/models/info")
async def models_info():
    """Get information about loaded models"""
    return {
        "price_model": "XGBoost Regressor" if geotrendsync.price_model else "Not loaded",
        "growth_model": "K-Means Clustering" if geotrendsync.growth_model else "Not loaded",
        "scaler": "StandardScaler" if geotrendsync.scaler else "Not loaded",
        "nlp_model": "spaCy en_core_web_sm" if nlp else "Not loaded"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 