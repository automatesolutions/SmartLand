import requests
import json
import pandas as pd
from typing import Dict, List, Optional
import time
from loguru import logger

class OSMDataCollector:
    """Collects geospatial data from OpenStreetMap for Philippine real estate analysis"""
    
    def __init__(self):
        self.base_url = "https://overpass-api.de/api/interpreter"
        self.headers = {
            'User-Agent': 'SmartLand-GeoTrendSync/1.0'
        }
    
    def get_amenities_near_location(self, lat: float, lon: float, radius: float = 5000) -> Dict:
        """Get amenities (malls, schools, hospitals) near a location"""
        query = f"""
        [out:json][timeout:25];
        (
          node["amenity"="mall"](around:{radius},{lat},{lon});
          node["amenity"="school"](around:{radius},{lat},{lon});
          node["amenity"="hospital"](around:{radius},{lat},{lon});
          node["amenity"="university"](around:{radius},{lat},{lon});
          node["shop"="supermarket"](around:{radius},{lat},{lon});
          node["leisure"="park"](around:{radius},{lat},{lon});
          way["amenity"="mall"](around:{radius},{lat},{lon});
          way["amenity"="school"](around:{radius},{lat},{lon});
          way["amenity"="hospital"](around:{radius},{lat},{lon});
        );
        out center;
        """
        
        try:
            response = requests.post(self.base_url, data=query, headers=self.headers)
            response.raise_for_status()
            data = response.json()
            
            amenities = {
                'malls': [],
                'schools': [],
                'hospitals': [],
                'universities': [],
                'supermarkets': [],
                'parks': []
            }
            
            for element in data.get('elements', []):
                if element['type'] == 'node':
                    name = element.get('tags', {}).get('name', 'Unknown')
                    amenity_type = element.get('tags', {}).get('amenity', '')
                    shop_type = element.get('tags', {}).get('shop', '')
                    leisure_type = element.get('tags', {}).get('leisure', '')
                    
                    location = {
                        'name': name,
                        'lat': element['lat'],
                        'lon': element['lon'],
                        'distance': self._calculate_distance(lat, lon, element['lat'], element['lon'])
                    }
                    
                    if amenity_type == 'mall':
                        amenities['malls'].append(location)
                    elif amenity_type == 'school':
                        amenities['schools'].append(location)
                    elif amenity_type == 'hospital':
                        amenities['hospitals'].append(location)
                    elif amenity_type == 'university':
                        amenities['universities'].append(location)
                    elif shop_type == 'supermarket':
                        amenities['supermarkets'].append(location)
                    elif leisure_type == 'park':
                        amenities['parks'].append(location)
            
            return amenities
            
        except Exception as e:
            logger.error(f"Error fetching OSM amenities: {e}")
            return {}
    
    def get_land_use_data(self, lat: float, lon: float, radius: float = 2000) -> Dict:
        """Get land use information for an area"""
        query = f"""
        [out:json][timeout:25];
        (
          way["landuse"](around:{radius},{lat},{lon});
          way["building"](around:{radius},{lat},{lon});
          way["highway"](around:{radius},{lat},{lon});
        );
        out center;
        """
        
        try:
            response = requests.post(self.base_url, data=query, headers=self.headers)
            response.raise_for_status()
            data = response.json()
            
            land_use = {
                'residential': 0,
                'commercial': 0,
                'industrial': 0,
                'agricultural': 0,
                'roads': 0,
                'buildings': 0
            }
            
            for element in data.get('elements', []):
                if element['type'] == 'way':
                    landuse_type = element.get('tags', {}).get('landuse', '')
                    building_type = element.get('tags', {}).get('building', '')
                    highway_type = element.get('tags', {}).get('highway', '')
                    
                    if landuse_type == 'residential':
                        land_use['residential'] += 1
                    elif landuse_type == 'commercial':
                        land_use['commercial'] += 1
                    elif landuse_type == 'industrial':
                        land_use['industrial'] += 1
                    elif landuse_type == 'agricultural':
                        land_use['agricultural'] += 1
                    elif building_type:
                        land_use['buildings'] += 1
                    elif highway_type:
                        land_use['roads'] += 1
            
            return land_use
            
        except Exception as e:
            logger.error(f"Error fetching OSM land use: {e}")
            return {}
    
    def get_transportation_data(self, lat: float, lon: float, radius: float = 3000) -> Dict:
        """Get transportation infrastructure data"""
        query = f"""
        [out:json][timeout:25];
        (
          node["railway"="station"](around:{radius},{lat},{lon});
          node["highway"="bus_stop"](around:{radius},{lat},{lon});
          way["highway"="primary"](around:{radius},{lat},{lon});
          way["highway"="secondary"](around:{radius},{lat},{lon});
          way["highway"="tertiary"](around:{radius},{lat},{lon});
        );
        out center;
        """
        
        try:
            response = requests.post(self.base_url, data=query, headers=self.headers)
            response.raise_for_status()
            data = response.json()
            
            transport = {
                'train_stations': [],
                'bus_stops': [],
                'primary_roads': 0,
                'secondary_roads': 0,
                'tertiary_roads': 0
            }
            
            for element in data.get('elements', []):
                if element['type'] == 'node':
                    railway_type = element.get('tags', {}).get('railway', '')
                    highway_type = element.get('tags', {}).get('highway', '')
                    
                    if railway_type == 'station':
                        transport['train_stations'].append({
                            'name': element.get('tags', {}).get('name', 'Unknown'),
                            'lat': element['lat'],
                            'lon': element['lon'],
                            'distance': self._calculate_distance(lat, lon, element['lat'], element['lon'])
                        })
                    elif highway_type == 'bus_stop':
                        transport['bus_stops'].append({
                            'name': element.get('tags', {}).get('name', 'Unknown'),
                            'lat': element['lat'],
                            'lon': element['lon'],
                            'distance': self._calculate_distance(lat, lon, element['lat'], element['lon'])
                        })
                elif element['type'] == 'way':
                    highway_type = element.get('tags', {}).get('highway', '')
                    
                    if highway_type == 'primary':
                        transport['primary_roads'] += 1
                    elif highway_type == 'secondary':
                        transport['secondary_roads'] += 1
                    elif highway_type == 'tertiary':
                        transport['tertiary_roads'] += 1
            
            return transport
            
        except Exception as e:
            logger.error(f"Error fetching OSM transportation: {e}")
            return {}
    
    def _calculate_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two points using Haversine formula"""
        import math
        
        R = 6371  # Earth's radius in kilometers
        
        lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        return R * c
    
    def get_location_features(self, lat: float, lon: float) -> Dict:
        """Get comprehensive location features for GeoTrendSync analysis"""
        logger.info(f"Collecting OSM data for location: {lat}, {lon}")
        
        # Collect all data types
        amenities = self.get_amenities_near_location(lat, lon)
        land_use = self.get_land_use_data(lat, lon)
        transport = self.get_transportation_data(lat, lon)
        
        # Calculate proximity scores
        proximity_scores = self._calculate_proximity_scores(amenities)
        
        # Calculate infrastructure score
        infrastructure_score = self._calculate_infrastructure_score(land_use, transport)
        
        features = {
            'amenities': amenities,
            'land_use': land_use,
            'transport': transport,
            'proximity_scores': proximity_scores,
            'infrastructure_score': infrastructure_score
        }
        
        logger.info(f"Collected features for location: {len(amenities['malls'])} malls, {len(amenities['schools'])} schools, infrastructure score: {infrastructure_score}")
        
        return features
    
    def _calculate_proximity_scores(self, amenities: Dict) -> Dict:
        """Calculate proximity scores for different amenity types"""
        scores = {}
        
        for amenity_type, locations in amenities.items():
            if locations:
                # Get the closest distance
                closest_distance = min(loc['distance'] for loc in locations)
                # Convert to score (closer = higher score)
                scores[f'{amenity_type}_proximity'] = max(0, 10 - closest_distance)
            else:
                scores[f'{amenity_type}_proximity'] = 0
        
        return scores
    
    def _calculate_infrastructure_score(self, land_use: Dict, transport: Dict) -> float:
        """Calculate overall infrastructure score (0-10)"""
        score = 0
        
        # Land use diversity
        land_use_types = sum(1 for count in land_use.values() if count > 0)
        score += min(3, land_use_types)
        
        # Road density
        total_roads = land_use.get('roads', 0) + transport.get('primary_roads', 0) + transport.get('secondary_roads', 0)
        score += min(3, total_roads / 10)
        
        # Public transport
        transport_points = len(transport.get('train_stations', [])) + len(transport.get('bus_stops', []))
        score += min(2, transport_points / 5)
        
        # Building density
        buildings = land_use.get('buildings', 0)
        score += min(2, buildings / 20)
        
        return min(10, score)

# Example usage
if __name__ == "__main__":
    collector = OSMDataCollector()
    
    # Example: Metro Manila coordinates
    lat, lon = 14.5995, 120.9842
    
    features = collector.get_location_features(lat, lon)
    print(json.dumps(features, indent=2)) 