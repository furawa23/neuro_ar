using System;

namespace NeuroAR.Vision
{
    /// <summary>
    /// Converts an upright top-left image into Unity WebCamTexture's bottom-left
    /// raw pixels. The background and detector must use this same transform.
    /// </summary>
    public static class CameraFrameMapping
    {
        public static void GetUprightSize(int rawWidth, int rawHeight, int rotationClockwise, out int width, out int height)
        {
            ValidateSize(rawWidth, rawHeight);
            int angle = NormalizeAngle(rotationClockwise);
            bool transpose = angle == 90 || angle == 270;
            width = transpose ? rawHeight : rawWidth;
            height = transpose ? rawWidth : rawHeight;
        }

        public static int GetRawPixelIndex(int uprightX, int uprightY, int rawWidth, int rawHeight,
            int rotationClockwise, bool verticallyMirrored)
        {
            GetUprightSize(rawWidth, rawHeight, rotationClockwise, out int width, out int height);
            if (uprightX < 0 || uprightX >= width) throw new ArgumentOutOfRangeException(nameof(uprightX));
            if (uprightY < 0 || uprightY >= height) throw new ArgumentOutOfRangeException(nameof(uprightY));
            int x;
            int y;
            switch (NormalizeAngle(rotationClockwise))
            {
                case 0: x = uprightX; y = rawHeight - 1 - uprightY; break;
                case 90: x = uprightY; y = uprightX; break;
                case 180: x = rawWidth - 1 - uprightX; y = uprightY; break;
                default: x = rawWidth - 1 - uprightY; y = rawHeight - 1 - uprightX; break;
            }
            if (verticallyMirrored) y = rawHeight - 1 - y;
            return checked(y * rawWidth + x);
        }

        /// <summary>u/v are canonical image coordinates: left/right and top/bottom, both 0..1.</summary>
        public static ImagePoint MapUprightToRawUv(double u, double v, int rotationClockwise, bool verticallyMirrored)
        {
            if (!Finite(u) || u < 0 || u > 1) throw new ArgumentOutOfRangeException(nameof(u));
            if (!Finite(v) || v < 0 || v > 1) throw new ArgumentOutOfRangeException(nameof(v));
            double x;
            double y;
            switch (NormalizeAngle(rotationClockwise))
            {
                case 0: x = u; y = 1 - v; break;
                case 90: x = v; y = u; break;
                case 180: x = 1 - u; y = v; break;
                default: x = 1 - v; y = 1 - u; break;
            }
            return new ImagePoint(x, verticallyMirrored ? 1 - y : y);
        }

        private static int NormalizeAngle(int angle)
        {
            int normalized = ((angle % 360) + 360) % 360;
            if (normalized % 90 != 0) throw new ArgumentOutOfRangeException(nameof(angle), "Camera rotation must be a multiple of 90 degrees.");
            return normalized;
        }

        private static void ValidateSize(int width, int height)
        {
            if (width <= 0 || height <= 0 || (long)width * height > int.MaxValue)
                throw new ArgumentOutOfRangeException(nameof(width), "Camera dimensions must be positive and fit an array.");
        }

        private static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
    }
}
