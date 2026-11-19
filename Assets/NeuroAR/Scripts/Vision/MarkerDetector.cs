using System;
using System.Collections.Generic;

namespace NeuroAR.Vision
{
    /// <summary>
    /// A small, camera-only detector for the single NeuroAR printed fiducial.
    /// Otsu segmentation finds isolated dark components; their outer convex hull
    /// yields quadrilaterals. Perspective-normalized cells are checked against
    /// the known asymmetric payload in all four rotations. It is deliberately
    /// conservative: partial, mirrored and undecodable targets are not tracked.
    /// </summary>
    public sealed class MarkerDetector
    {
        private readonly int[] histogram = new int[256];
        private readonly List<ImagePoint> boundary = new List<ImagePoint>(1024);
        private readonly List<ImagePoint> hull = new List<ImagePoint>(1024);
        private readonly double[] cells = new double[49];
        private readonly ImagePoint[] quad = new ImagePoint[4];
        private readonly double[] fittedLines = new double[12];
        private readonly ImagePoint[] refinedQuad = new ImagePoint[4];
        private byte[] mask = Array.Empty<byte>();
        private int[] queue = Array.Empty<int>();
        private int[] rowMinimum = Array.Empty<int>();
        private int[] rowMaximum = Array.Empty<int>();
        private int[] rowStamp = Array.Empty<int>();
        private int[] touchedRows = Array.Empty<int>();
        private int componentStamp;

        public bool TryDetect(byte[] grayscale, int width, int height, out MarkerObservation observation)
        {
            if (grayscale == null) throw new ArgumentNullException(nameof(grayscale));
            if (width < 1 || height < 1 || width > 8192 || height > 8192)
                throw new ArgumentOutOfRangeException(nameof(width), "Image dimensions must be between 1 and 8192.");
            long pixelsLong = (long)width * height;
            if (pixelsLong > grayscale.Length) throw new ArgumentException("The grayscale buffer is shorter than the image.", nameof(grayscale));
            int pixels = (int)pixelsLong;
            observation = null;
            EnsureBuffers(pixels, height);
            Array.Clear(histogram, 0, histogram.Length);
            int minimum = 255, maximum = 0;
            for (int i = 0; i < pixels; i++)
            {
                int value = grayscale[i];
                histogram[value]++;
                if (value < minimum) minimum = value;
                if (value > maximum) maximum = value;
            }
            if (maximum - minimum < 24) return false;
            int threshold = OtsuThreshold(pixels);
            for (int i = 0; i < pixels; i++) mask[i] = grayscale[i] <= threshold ? (byte)1 : (byte)0;

            double bestArea = 0;
            int bestErrors = int.MaxValue;
            for (int seed = 0; seed < pixels; seed++)
            {
                if (mask[seed] != 1) continue;
                if (++componentStamp == int.MaxValue)
                {
                    Array.Clear(rowStamp, 0, rowStamp.Length);
                    componentStamp = 1;
                }
                int head = 0, tail = 1, rows = 0;
                queue[0] = seed;
                mask[seed] = 3;
                int minX = width, minY = height, maxX = -1, maxY = -1;
                while (head < tail)
                {
                    int index = queue[head++];
                    int y = index / width;
                    int x = index - y * width;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    if (rowStamp[y] != componentStamp)
                    {
                        rowStamp[y] = componentStamp;
                        rowMinimum[y] = rowMaximum[y] = x;
                        touchedRows[rows++] = y;
                    }
                    else
                    {
                        if (x < rowMinimum[y]) rowMinimum[y] = x;
                        if (x > rowMaximum[y]) rowMaximum[y] = x;
                    }
                    if (x > 0) Enqueue(index - 1, ref tail);
                    if (x + 1 < width) Enqueue(index + 1, ref tail);
                    if (y > 0) Enqueue(index - width, ref tail);
                    if (y + 1 < height) Enqueue(index + width, ref tail);
                }

                int boxWidth = maxX - minX + 1;
                int boxHeight = maxY - minY + 1;
                if (boxWidth < 35 || boxHeight < 35 || tail < 140 || minX == 0 || minY == 0 || maxX == width - 1 || maxY == height - 1) continue;
                double fill = (double)tail / (boxWidth * boxHeight);
                if (fill < 0.12 || fill > 0.94 || boxWidth > boxHeight * 5 || boxHeight > boxWidth * 5) continue;
                boundary.Clear();
                for (int i = 0; i < rows; i++)
                {
                    int y = touchedRows[i];
                    boundary.Add(new ImagePoint(rowMinimum[y], y));
                    if (rowMinimum[y] != rowMaximum[y]) boundary.Add(new ImagePoint(rowMaximum[y], y));
                }
                if (!FindQuadrilateral()) continue;
                double area = PolygonArea(quad);
                if (!ValidateQuadrilateral(area)) continue;
                int rotation, errors;
                if (!Decode(grayscale, width, height, out rotation, out errors)) continue;
                if (errors > bestErrors || (errors == bestErrors && area <= bestArea)) continue;
                bestArea = area;
                bestErrors = errors;
                var corners = new ImagePoint[4];
                for (int i = 0; i < 4; i++) corners[i] = quad[(i + rotation) % 4];
                observation = new MarkerObservation { Corners = corners, BitErrors = errors, PixelArea = area };
            }
            return observation != null;
        }

        private void EnsureBuffers(int pixels, int height)
        {
            if (mask.Length < pixels) { mask = new byte[pixels]; queue = new int[pixels]; }
            if (rowMinimum.Length < height)
            {
                rowMinimum = new int[height]; rowMaximum = new int[height];
                rowStamp = new int[height]; touchedRows = new int[height];
                componentStamp = 0;
            }
        }

        private void Enqueue(int index, ref int tail)
        {
            if (mask[index] != 1) return;
            mask[index] = 3;
            queue[tail++] = index;
        }

        private int OtsuThreshold(int count)
        {
            double total = 0;
            for (int i = 0; i < 256; i++) total += (double)i * histogram[i];
            double sum = 0, best = -1;
            int background = 0, threshold = 0;
            for (int i = 0; i < 255; i++)
            {
                background += histogram[i];
                sum += (double)i * histogram[i];
                if (background == 0) continue;
                int foreground = count - background;
                if (foreground == 0) break;
                double difference = sum / background - (total - sum) / foreground;
                double variance = (double)background * foreground * difference * difference;
                if (variance > best) { best = variance; threshold = i; }
            }
            return threshold;
        }

        private bool FindQuadrilateral()
        {
            boundary.Sort(PointComparer.Instance);
            hull.Clear();
            for (int i = 0; i < boundary.Count; i++)
            {
                ImagePoint point = boundary[i];
                while (hull.Count >= 2 && Cross(hull[hull.Count - 2], hull[hull.Count - 1], point) <= 0) hull.RemoveAt(hull.Count - 1);
                hull.Add(point);
            }
            int upperStart = hull.Count + 1;
            for (int i = boundary.Count - 2; i >= 0; i--)
            {
                ImagePoint point = boundary[i];
                while (hull.Count >= upperStart && Cross(hull[hull.Count - 2], hull[hull.Count - 1], point) <= 0) hull.RemoveAt(hull.Count - 1);
                hull.Add(point);
            }
            if (hull.Count > 0) hull.RemoveAt(hull.Count - 1);
            if (hull.Count < 4) return false;
            // Raster stair steps create many tiny hull triangles. The four physical
            // corners survive successive removal of the least significant vertex.
            while (hull.Count > 4)
            {
                double smallest = double.MaxValue;
                int remove = -1;
                for (int i = 0; i < hull.Count; i++)
                {
                    double significance = Math.Abs(Cross(hull[(i + hull.Count - 1) % hull.Count], hull[i], hull[(i + 1) % hull.Count]));
                    if (significance < smallest) { smallest = significance; remove = i; }
                }
                hull.RemoveAt(remove);
            }
            int first = 0;
            for (int i = 1; i < 4; i++)
                if (hull[i].X + hull[i].Y < hull[first].X + hull[first].Y) first = i;
            for (int i = 0; i < 4; i++) quad[i] = hull[(first + i) % 4];
            RefineCorners();
            return true;
        }

        private void RefineCorners()
        {
            // The strongest raster hull vertex can sit several pixels away from
            // the physical corner. Refit straight sides from contour samples and
            // intersect them rather than passing that stair-step jitter to pose.
            for (int edge = 0; edge < 4; edge++)
            {
                ImagePoint a = quad[edge], b = quad[(edge + 1) % 4];
                double dx = b.X - a.X, dy = b.Y - a.Y;
                double lengthSquared = dx * dx + dy * dy;
                if (lengthSquared < 1) return;
                double inverseLength = 1 / Math.Sqrt(lengthSquared);
                double nx = -dy * inverseLength, ny = dx * inverseLength;
                double c = -(nx * a.X + ny * a.Y);
                double sumX = 0, sumY = 0, sumXX = 0, sumXY = 0, sumYY = 0;
                int count = 0;
                for (int i = 0; i < boundary.Count; i++)
                {
                    ImagePoint p = boundary[i];
                    double t = ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / lengthSquared;
                    if (t < 0.07 || t > 0.93 || Math.Abs(nx * p.X + ny * p.Y + c) > 2.6) continue;
                    sumX += p.X; sumY += p.Y;
                    sumXX += p.X * p.X; sumXY += p.X * p.Y; sumYY += p.Y * p.Y;
                    count++;
                }
                if (count >= 3)
                {
                    double mx = sumX / count, my = sumY / count;
                    double xx = sumXX / count - mx * mx, xy = sumXY / count - mx * my, yy = sumYY / count - my * my;
                    double angle = 0.5 * Math.Atan2(2 * xy, xx - yy);
                    nx = -Math.Sin(angle); ny = Math.Cos(angle);
                    c = -(nx * mx + ny * my);
                }
                fittedLines[edge * 3] = nx;
                fittedLines[edge * 3 + 1] = ny;
                fittedLines[edge * 3 + 2] = c;
            }
            for (int corner = 0; corner < 4; corner++)
            {
                int previous = (corner + 3) % 4;
                double a = fittedLines[previous * 3], b = fittedLines[previous * 3 + 1], c = fittedLines[previous * 3 + 2];
                double d = fittedLines[corner * 3], e = fittedLines[corner * 3 + 1], f = fittedLines[corner * 3 + 2];
                double determinant = a * e - b * d;
                if (Math.Abs(determinant) < 0.05) return;
                var refined = new ImagePoint((b * f - c * e) / determinant, (c * d - a * f) / determinant);
                if (Distance(refined, quad[corner]) > 12) return;
                refinedQuad[corner] = refined;
            }
            for (int i = 0; i < 4; i++) quad[i] = refinedQuad[i];
        }

        private bool ValidateQuadrilateral(double area)
        {
            if (area < 850) return false;
            double shortest = double.MaxValue, longest = 0;
            for (int i = 0; i < 4; i++)
            {
                ImagePoint a = quad[i], b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
                double length = Distance(a, b);
                if (length < shortest) shortest = length;
                if (length > longest) longest = length;
                double adjacent = Distance(b, c);
                if (length == 0 || adjacent == 0 || Cross(a, b, c) / (length * adjacent) < 0.16) return false;
            }
            return shortest >= 28 && longest / shortest < 5;
        }

        private bool Decode(byte[] grayscale, int width, int height, out int rotation, out int errors)
        {
            rotation = -1;
            errors = int.MaxValue;
            Homography map;
            if (!Homography.TryCreate(quad, out map)) return false;
            double low = 255, high = 0;
            for (int row = 0; row < 7; row++)
            {
                for (int col = 0; col < 7; col++)
                {
                    double u = (col + 0.5) / 7, v = (row + 0.5) / 7;
                    const double offset = 0.16 / 7;
                    double value = Sample(grayscale, width, height, map.Project(u, v))
                        + Sample(grayscale, width, height, map.Project(u + offset, v))
                        + Sample(grayscale, width, height, map.Project(u - offset, v))
                        + Sample(grayscale, width, height, map.Project(u, v + offset))
                        + Sample(grayscale, width, height, map.Project(u, v - offset));
                    value *= 0.2;
                    cells[row * 7 + col] = value;
                    if (value < low) low = value;
                    if (value > high) high = value;
                }
            }
            for (int iteration = 0; iteration < 5; iteration++)
            {
                double sumLow = 0, sumHigh = 0;
                int countLow = 0, countHigh = 0;
                double middle = (low + high) * 0.5;
                for (int i = 0; i < cells.Length; i++)
                {
                    if (cells[i] <= middle) { sumLow += cells[i]; countLow++; }
                    else { sumHigh += cells[i]; countHigh++; }
                }
                if (countLow == 0 || countHigh == 0) return false;
                low = sumLow / countLow;
                high = sumHigh / countHigh;
            }
            if (high - low < 28) return false;
            double threshold = (low + high) * 0.5;
            int borderErrors = 0;
            for (int r = 0; r < 7; r++)
                for (int c = 0; c < 7; c++)
                    if ((r == 0 || c == 0 || r == 6 || c == 6) && cells[r * 7 + c] > threshold) borderErrors++;
            if (borderErrors > 1) return false;
            for (int candidate = 0; candidate < 4; candidate++)
            {
                int mismatch = 0;
                for (int r = 1; r < 6; r++)
                    for (int c = 1; c < 6; c++)
                        if ((cells[r * 7 + c] > threshold) != RotatedWhite(r, c, candidate)) mismatch++;
                if (mismatch < errors) { errors = mismatch; rotation = candidate; }
            }
            return errors <= 1;
        }

        private static bool RotatedWhite(int row, int col, int rotation)
        {
            switch (rotation)
            {
                case 1: return MarkerDefinition.IsWhite(6 - col, row);
                case 2: return MarkerDefinition.IsWhite(6 - row, 6 - col);
                case 3: return MarkerDefinition.IsWhite(col, 6 - row);
                default: return MarkerDefinition.IsWhite(row, col);
            }
        }

        private static double Sample(byte[] image, int width, int height, ImagePoint point)
        {
            int x = (int)Math.Round(point.X), y = (int)Math.Round(point.Y);
            x = Math.Min(width - 1, Math.Max(0, x));
            y = Math.Min(height - 1, Math.Max(0, y));
            return image[y * width + x];
        }

        private static double Cross(ImagePoint a, ImagePoint b, ImagePoint c)
        { return (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X); }
        private static double Distance(ImagePoint a, ImagePoint b)
        { double x = b.X - a.X, y = b.Y - a.Y; return Math.Sqrt(x * x + y * y); }
        private static double PolygonArea(ImagePoint[] points)
        {
            double result = 0;
            for (int i = 0; i < 4; i++) result += points[i].X * points[(i + 1) % 4].Y - points[(i + 1) % 4].X * points[i].Y;
            return Math.Abs(result) * 0.5;
        }

        private sealed class PointComparer : IComparer<ImagePoint>
        {
            public static readonly PointComparer Instance = new PointComparer();
            public int Compare(ImagePoint a, ImagePoint b)
            { int x = a.X.CompareTo(b.X); return x == 0 ? a.Y.CompareTo(b.Y) : x; }
        }

        private readonly struct Homography
        {
            private readonly double a, b, c, d, e, f, g, h;
            private Homography(double a, double b, double c, double d, double e, double f, double g, double h)
            { this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f; this.g = g; this.h = h; }
            public ImagePoint Project(double x, double y)
            {
                double denominator = g * x + h * y + 1;
                return new ImagePoint((a * x + b * y + c) / denominator, (d * x + e * y + f) / denominator);
            }
            public static bool TryCreate(ImagePoint[] q, out Homography map)
            {
                double dx1 = q[1].X - q[2].X, dx2 = q[3].X - q[2].X;
                double dy1 = q[1].Y - q[2].Y, dy2 = q[3].Y - q[2].Y;
                double sx = q[0].X - q[1].X + q[2].X - q[3].X;
                double sy = q[0].Y - q[1].Y + q[2].Y - q[3].Y;
                double denominator = dx1 * dy2 - dx2 * dy1;
                if (Math.Abs(denominator) < 1e-8) { map = default(Homography); return false; }
                double g = (sx * dy2 - dx2 * sy) / denominator;
                double h = (dx1 * sy - sx * dy1) / denominator;
                map = new Homography(q[1].X - q[0].X + g * q[1].X, q[3].X - q[0].X + h * q[3].X, q[0].X,
                    q[1].Y - q[0].Y + g * q[1].Y, q[3].Y - q[0].Y + h * q[3].Y, q[0].Y, g, h);
                return true;
            }
        }
    }
}
