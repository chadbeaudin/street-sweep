# StreetSweep

**StreetSweep** is a web application designed to help runners and cyclists achieve 100% street coverage in a given area. It generates optimized routes that traverse every accessible street within a selected area with minimal backtracking, effectively solving the Chinese Postman Problem for custom bounding boxes.  It will pull in all of your rides from Strava and show you which streets you have already ridden and which streets you still need to ride.

## Features

- **Interactive Map**: Select your target area visually using a dynamic map interface (Leaflet).
- **Optimized Routing**: Uses the **Chinese Postman Algorithm** to calculate the most efficient path to cover all streets.
- **Elevation Profiles**: Rich 3D elevation data for every route, powered by a multi-provider fallback system.
- **GPX Export**: Download the generated route as a GPX file to use with Garmin, Wahoo, or other GPS devices.
- **Stack**: Built with Next.js 14, TypeScript, and TailwindCSS for a fast, responsive user experience.

## Getting Started

### Prerequisites

- Node.js 18+ installed on your machine.

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/chadbeaudin/street-sweep.git
    cd street-sweep
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

### Running Locally

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3888](http://localhost:3888) in your browser.

1.  **Move the map** to center on the neighborhood you want to sweep.
2.  Click **Generate Route**.
3.  Wait for the graph processing to complete.
4.  View the route on the map and click **Download GPX** to save it.

```bash
npm run build
npm start
```

## Elevation Data

StreetSweep uses a multi-provider fallback system to ensure reliable elevation data fetching:

- **Primary: Open Topo Data** - Preferred for its accuracy and robust handling of point queries using various datasets (SRTM, NED).
- **Secondary: Open-Meteo** - Acts as a high-capacity fallback. It is optimized with large-batch processing (up to 500 points per request) to minimize API overhead and avoid rate limits.

The system automatically switches providers if the primary is down or rate-limited, ensuring that your route always has accurate altitude information.

## Tech Stack

- **Frontend**: [Next.js](https://nextjs.org/) (App Router), [React](https://react.dev/), [TailwindCSS](https://tailwindcss.com/)
- **Maps**: [React Leaflet](https://react-leaflet.js.org/), [OpenStreetMap](https://www.openstreetmap.org/)
- **Data Source**: [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) (OSM Data)
- **Elevation**: [Open Topo Data](https://www.opentopodata.org/), [Open-Meteo](https://open-meteo.com/)
- **Graph Processing**:
    - `ngraph.graph` for graph data structure.
    - `ngraph.path` for shortest path calculations (A*).
    - Custom implementation of the Chinese Postman Problem (odd-degree node matching + Eulerian trail).

## License

This project is open source.
