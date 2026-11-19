namespace NeuroAR.Vision
{
    /// <summary>Image coordinates use the top-left origin, x right and y down.</summary>
    public readonly struct ImagePoint
    {
        public readonly double X;
        public readonly double Y;
        public ImagePoint(double x, double y) { X = x; Y = y; }
    }

    public sealed class MarkerObservation
    {
        // Canonical PRINT order: top-left, top-right, bottom-right, bottom-left,
        // independent of the target's orientation inside the camera image.
        public ImagePoint[] Corners;
        public int BitErrors;
        public double PixelArea;
    }
}
