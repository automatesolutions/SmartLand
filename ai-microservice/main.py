import os
import asyncio
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from loguru import logger
from datetime import datetime, timedelta
import json

load_dotenv()

app = FastAPI(title="SmartLand AI Microservice", version="1.0.0")

# Logging setup
logger.add("ai_error.log", level="ERROR")
logger.add("ai_combined.log", level="INFO")

class GeoTrendSync:
    def __init__(self):
        logger.info("Initializing GeoTrendSync with simple prediction models")
        
    def predict_price(self, features):
        """Simple price prediction function"""
        base_price = 3000  # Base price per sqm
        price_multiplier = 1.0
        
        # Adjust based on infrastructure
        if features.get('infrastructure_score', 0) > 7:
            price_multiplier += 0.3
        elif features.get('infrastructure_score', 0) < 4:
            price_multiplier -= 0.2
        
        # Adjust based on economic factors
        if features.get('gdp_growth', 0) > 5:
            price_multiplier += 0.2
        if features.get('population_growth', 0) > 3:
            price_multiplier += 0.15
        
        # Adjust based on proximity to amenities
        if features.get('proximity_to_mall', 5) < 3:
            price_multiplier += 0.1
        if features.get('proximity_to_school', 3) < 2:
            price_multiplier += 0.05
        if features.get('proximity_to_hospital', 4) < 3:
            price_multiplier += 0.05
        
        # Adjust based on risk
        if features.get('typhoon_risk', 0) > 5:
            price_multiplier -= 0.15
        
        return base_price * price_multiplier
    
    def predict_growth(self, features):
        """Simple growth scoring function"""
        growth_score = 50  # Base score
        
        # Infrastructure impact
        growth_score += features.get('infrastructure_score', 0) * 5
        
        # Economic impact
        growth_score += features.get('gdp_growth', 0) * 3
        growth_score += features.get('population_growth', 0) * 2
        
        # Amenity impact
        if features.get('proximity_to_mall', 5) < 3:
            growth_score += 10
        if features.get('proximity_to_school', 3) < 2:
            growth_score += 5
        if features.get('proximity_to_hospital', 4) < 3:
            growth_score += 5
        
        # Risk impact
        growth_score -= features.get('typhoon_risk', 0) * 3
        
        return max(0, min(100, growth_score))
    
    def extract_news_insights(self, news_text: str) -> dict:
        """Extract insights from news text using simple text analysis"""
        if not news_text:
            return {"sentiment": "neutral", "entities": [], "insights": []}
        
        # Simple keyword analysis
        news_lower = news_text.lower()
        insights = []
        
        # Check for infrastructure keywords
        if any(word in news_lower for word in ["infrastructure", "development", "project"]):
            insights.append("Infrastructure development mentioned")
        if any(word in news_lower for word in ["airport", "transportation", "railway"]):
            insights.append("Transportation development")
        if any(word in news_lower for word in ["mall", "commercial", "business"]):
            insights.append("Commercial development")
        if any(word in news_lower for word in ["school", "education", "university"]):
            insights.append("Educational facilities")
        if any(word in news_lower for word in ["hospital", "medical", "healthcare"]):
            insights.append("Healthcare facilities")
        
        # Simple sentiment analysis
        positive_words = ["announced", "investment", "growth", "development", "new", "expansion"]
        negative_words = ["delay", "cancelled", "problem", "issue", "concern"]
        
        positive_count = sum(1 for word in positive_words if word in news_lower)
        negative_count = sum(1 for word in negative_words if word in news_lower)
        
        if positive_count > negative_count:
            sentiment = "positive"
        elif negative_count > positive_count:
            sentiment = "negative"
        else:
            sentiment = "neutral"
        
        return {
            "sentiment": sentiment,
            "entities": [],  # Simplified - no NLP entities
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
            'proximity_to_mall': data.get('proximity_to_mall', 5),
            'proximity_to_school': data.get('proximity_to_school', 3),
            'proximity_to_hospital': data.get('proximity_to_hospital', 4),
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
        
        # Predict price using simple model
        predicted_price = self.predict_price(features)
        
        # Predict growth using simple model
        growth_score = self.predict_growth(features)
        
        # Map growth score to category
        if growth_score > 80:
            category = 'A+ (Prime Investment)'
        elif growth_score > 60:
            category = 'A to B+ (High Growth)'
        elif growth_score > 40:
            category = 'B to C (Moderate Growth)'
        else:
            category = 'C- (High Risk)'
        
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
        "models_loaded": True,
        "timestamp": datetime.now().isoformat()
    }

@app.get("/models/info")
async def models_info():
    """Get information about loaded models"""
    return {
        "price_model": "Simple Price Predictor",
        "growth_model": "Simple Growth Scorer",
        "version": "Simplified v1.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002) 