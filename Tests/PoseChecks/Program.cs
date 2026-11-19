using System;
using System.Collections.Generic;
using NeuroAR.Vision;

internal static class Program
{
    private static int checks;
    private static readonly CameraIntrinsics Intrinsics = new CameraIntrinsics(565, 568, 256, 192);

    private static void Main()
    {
        CheckMapping();
        CheckPose();
        CheckRenderedMarkerPose();
        Console.WriteLine("PASS: " + checks + " marker-pose and frame-mapping assertions.");
    }

    private static void Assert(bool condition, string message)
    {
        checks++;
        if (!condition) throw new Exception(message);
    }

    private static void Close(double expected, double actual, double tolerance, string message)
    {
        Assert(Math.Abs(expected - actual) <= tolerance, message + ": expected " + expected + ", got " + actual);
    }

    private static void CheckMapping()
    {
        foreach (int angle in new[] { 0, 90, 180, 270, 450, -90 })
            foreach (bool mirrored in new[] { false, true })
            {
                CameraFrameMapping.GetUprightSize(7, 5, angle, out int width, out int height);
                var visited = new HashSet<int>();
                for (int y = 0; y < height; y++)
                    for (int x = 0; x < width; x++)
                    {
                        int index = CameraFrameMapping.GetRawPixelIndex(x, y, 7, 5, angle, mirrored);
                        Assert(index >= 0 && index < 35 && visited.Add(index), "Camera mapping must be bijective");
                        ImagePoint uv = CameraFrameMapping.MapUprightToRawUv((double)x / (width - 1), (double)y / (height - 1), angle, mirrored);
                        Close(index % 7, uv.X * 6, 1e-10, "UV/pixel horizontal consistency");
                        Close(index / 7, uv.Y * 4, 1e-10, "UV/pixel vertical consistency");
                    }
                Assert(visited.Count == 35, "Mapping visits every raw pixel");
            }
        Assert(CameraFrameMapping.GetRawPixelIndex(0, 0, 3, 2, 0, false) == 3, "Upright top-left is raw top-left");
        Assert(CameraFrameMapping.GetRawPixelIndex(0, 0, 3, 2, 90, false) == 0, "90 degree mapping orientation");
        Assert(CameraFrameMapping.GetRawPixelIndex(0, 0, 3, 2, 180, false) == 2, "180 degree mapping orientation");
        Assert(CameraFrameMapping.GetRawPixelIndex(0, 0, 3, 2, 270, false) == 5, "270 degree mapping orientation");
        Throws(() => CameraFrameMapping.GetRawPixelIndex(-1, 0, 3, 2, 0, false), "Negative coordinate rejected");
        Throws(() => CameraFrameMapping.MapUprightToRawUv(double.NaN, 0, 0, false), "Nonfinite UV rejected");
        Throws(() => CameraFrameMapping.GetUprightSize(3, 2, 45, out _, out _), "Unsupported angle rejected");
        Throws(() => CameraFrameMapping.GetUprightSize(0, 2, 0, out _, out _), "Zero image size rejected");
    }

    private static void CheckPose()
    {
        double[][] rotations =
        {
            Euler(0, 0, 0), Euler(12, -18, 35), Euler(-28, 42, 175),
            Euler(43, 30, -100), Euler(-55, -24, 72), Euler(5, 62, -10)
        };
        foreach (double[] rotation in rotations)
            foreach (double z in new[] { 0.25, 0.6, 1.2 })
            {
                var observation = Project(rotation, 0.021, -0.013, z, 0);
                Assert(MarkerPoseEstimator.TryEstimate(observation, Intrinsics, 0.14, out MarkerPose pose), "Exact pose accepted");
                Close(0.021, pose.X, 1e-7, "Translation X");
                Close(-0.013, pose.Y, 1e-7, "Translation Y");
                Close(z, pose.Z, 1e-7, "Translation Z");
                for (int i = 0; i < 9; i++) Close(rotation[i], pose.Rotation[i], 1e-6, "Rotation recovered");
                Assert(pose.ReprojectionError < 1e-6, "Exact reprojection error");
                CheckOrthonormal(pose.Rotation);
                var noisy = Project(rotation, 0.021, -0.013, z, 0.25);
                Assert(MarkerPoseEstimator.TryEstimate(noisy, Intrinsics, 0.14, out MarkerPose noisyPose), "Subpixel noisy pose accepted");
                Close(z, noisyPose.Z, 0.015 * z, "Noisy depth remains close");
                Assert(noisyPose.ReprojectionError < 0.6, "Noisy reprojection error bounded");
                CheckOrthonormal(noisyPose.Rotation);
            }
        Assert(!MarkerPoseEstimator.TryEstimate(null, Intrinsics, 0.14, out _), "Null observation rejected");
        Assert(!MarkerPoseEstimator.TryEstimate(new MarkerObservation { Corners = new ImagePoint[3] }, Intrinsics, 0.14, out _), "Wrong point count rejected");
        var valid = Project(Euler(10, 20, 30), 0, 0, 0.5, 0);
        Assert(!MarkerPoseEstimator.TryEstimate(valid, Intrinsics, 0, out _), "Zero marker width rejected");
        Assert(!MarkerPoseEstimator.TryEstimate(valid, new CameraIntrinsics(0, 400, 200, 200), 0.14, out _), "Invalid focal length rejected");
        Assert(!MarkerPoseEstimator.TryEstimate(valid, new CameraIntrinsics(400, 400, double.NaN, 200), 0.14, out _), "Invalid principal point rejected");
        var collinear = new MarkerObservation { Corners = new[] { new ImagePoint(0, 0), new ImagePoint(10, 0), new ImagePoint(20, 0), new ImagePoint(30, 0) } };
        Assert(!MarkerPoseEstimator.TryEstimate(collinear, Intrinsics, 0.14, out _), "Collinear marker rejected");
        var crossed = new MarkerObservation { Corners = new[] { valid.Corners[0], valid.Corners[2], valid.Corners[1], valid.Corners[3] } };
        Assert(!MarkerPoseEstimator.TryEstimate(crossed, Intrinsics, 0.14, out _), "Crossed corner order rejected");
        var reflected = new MarkerObservation { Corners = new[] { valid.Corners[1], valid.Corners[0], valid.Corners[3], valid.Corners[2] } };
        Assert(!MarkerPoseEstimator.TryEstimate(reflected, Intrinsics, 0.14, out _), "Mirrored order rejected");
    }

    private static MarkerObservation Project(double[] r, double tx, double ty, double tz, double noise)
    {
        var corners = new ImagePoint[4];
        double[] xs = { -0.07, 0.07, 0.07, -0.07 }, ys = { -0.07, -0.07, 0.07, 0.07 };
        for (int i = 0; i < 4; i++)
        {
            double x = r[0] * xs[i] + r[1] * ys[i] + tx;
            double y = r[3] * xs[i] + r[4] * ys[i] + ty;
            double z = r[6] * xs[i] + r[7] * ys[i] + tz;
            corners[i] = new ImagePoint(Intrinsics.Fx * x / z + Intrinsics.Cx + noise * Math.Sin(i * 1.7 + 0.4),
                Intrinsics.Fy * y / z + Intrinsics.Cy + noise * Math.Cos(i * 2.3 + 0.9));
        }
        return new MarkerObservation { Corners = corners };
    }

    private static void CheckRenderedMarkerPose()
    {
        var detector = new MarkerDetector();
        foreach (double[] rotation in new[] { Euler(12, -18, 35), Euler(-28, 32, 175), Euler(35, 20, -100) })
            foreach (double depth in new[] { 0.45, 0.8 })
            {
                var frame = RenderPhysicalMarker(rotation, 0.012, -0.009, depth);
                Assert(detector.TryDetect(frame, 512, 384, out MarkerObservation observation), "Rendered physical marker is detected");
                Assert(MarkerPoseEstimator.TryEstimate(observation, Intrinsics, 0.14, out MarkerPose pose), "Detected physical marker has a valid pose");
                Close(depth, pose.Z, depth * 0.04, "End-to-end depth remains within 4 percent on synthetic pinhole frame");
                Close(0.012, pose.X, 0.005, "End-to-end horizontal translation");
                Close(-0.009, pose.Y, 0.005, "End-to-end vertical translation");
                var truth = Project(rotation, 0.012, -0.009, depth, 0);
                var recovered = Project(pose.Rotation, pose.X, pose.Y, pose.Z, 0);
                for (int i = 0; i < 4; i++)
                {
                    double dx = truth.Corners[i].X - recovered.Corners[i].X;
                    double dy = truth.Corners[i].Y - recovered.Corners[i].Y;
                    Assert(Math.Sqrt(dx * dx + dy * dy) < 2, "End-to-end projected marker matches ground truth corners");
                }
            }
    }

    // Independent rasterization via ray/plane intersection; this never uses the
    // detector's quadrilateral homography or the pose estimator's linear solver.
    private static byte[] RenderPhysicalMarker(double[] r, double tx, double ty, double tz)
    {
        var frame = new byte[512 * 384];
        double planeDistance = r[2] * tx + r[5] * ty + r[8] * tz;
        for (int y = 0; y < 384; y++)
            for (int x = 0; x < 512; x++)
            {
                double rayX = (x - Intrinsics.Cx) / Intrinsics.Fx;
                double rayY = (y - Intrinsics.Cy) / Intrinsics.Fy;
                double rayScale = planeDistance / (r[2] * rayX + r[5] * rayY + r[8]);
                double deltaX = rayScale * rayX - tx, deltaY = rayScale * rayY - ty, deltaZ = rayScale - tz;
                double markerX = r[0] * deltaX + r[3] * deltaY + r[6] * deltaZ;
                double markerY = r[1] * deltaX + r[4] * deltaY + r[7] * deltaZ;
                int intensity = 238;
                if (Math.Abs(markerX) < 0.07 && Math.Abs(markerY) < 0.07)
                {
                    int row = Math.Min(6, (int)((markerY / 0.14 + 0.5) * 7));
                    int column = Math.Min(6, (int)((markerX / 0.14 + 0.5) * 7));
                    intensity = MarkerDefinition.IsWhite(row, column) ? 222 : 28;
                }
                intensity += (x + y) % 7 - 3;
                frame[y * 512 + x] = (byte)intensity;
            }
        return frame;
    }

    private static void CheckOrthonormal(double[] r)
    {
        for (int a = 0; a < 3; a++)
            for (int b = 0; b < 3; b++)
            {
                double dot = 0;
                for (int row = 0; row < 3; row++) dot += r[row * 3 + a] * r[row * 3 + b];
                Close(a == b ? 1 : 0, dot, 1e-7, "Rotation is orthonormal");
            }
    }

    private static double[] Euler(double x, double y, double z)
    {
        x *= Math.PI / 180; y *= Math.PI / 180; z *= Math.PI / 180;
        double sx = Math.Sin(x), cx = Math.Cos(x), sy = Math.Sin(y), cy = Math.Cos(y), sz = Math.Sin(z), cz = Math.Cos(z);
        return new[]
        {
            cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
            sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
            -sy, cy * sx, cy * cx
        };
    }

    private static void Throws(Action action, string message)
    {
        bool threw = false;
        try { action(); } catch (ArgumentException) { threw = true; }
        Assert(threw, message);
    }
}
